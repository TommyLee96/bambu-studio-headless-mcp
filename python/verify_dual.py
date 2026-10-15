# SPDX-License-Identifier: GPL-2.0-only
"""Verify one-plate X2D 0.4/0.4 sliced 3MF using metadata AND object deposition.

T commands select project material slots. Physical nozzles are established only
through the explicit filament_maps metadata; the H operand is not a nozzle ID.
This checks offline files, not hardware, temperature safety or print success.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

# Bambu emits ordinary decimal fields. E is the extrusion axis, including in
# compact G1X1Y1E0.2; treating it as scientific notation loses the E operand.
NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"
PARAMETER = re.compile(r"([A-Z])(" + NUMBER + r")")


def metadata(node):
    return {item.get("key"): item.get("value") for item in node.findall("metadata")}


def object_slots(config, plate):
    objects = {n.get("id"): n for n in config.findall("object")}
    result = {}
    for instance in plate.findall("model_instance"):
        info = metadata(instance)
        object_node = objects[info["object_id"]]
        slot = int(metadata(object_node).get("extruder", "0"))
        if slot not in (1, 2):
            raise ValueError("Each object needs an explicit material slot 1 or 2")
        parts = object_node.findall("part")
        if not parts:
            raise ValueError("Object has no mesh part metadata")
        for part in parts:
            override = metadata(part).get("extruder")
            if override is not None and int(override) not in (0, slot):
                raise ValueError("Mixed per-part material overrides are unsupported by this two-object verifier")
        label = info["identify_id"]
        if label in result:
            raise ValueError("Duplicate object identify_id")
        result[label] = slot
    if len(result) != 2 or set(result.values()) != {1, 2}:
        raise ValueError("Exactly two distinct object labels, one per material slot, are required")
    return result


def scan_deposition(gcode):
    commands = []
    deposits = Counter()
    examples = {}
    current_object = None
    tool = None
    relative_e = False
    relative_xy = False
    absolute_e = 0.0
    xy = {}
    for line_number, raw in enumerate(gcode.splitlines(), 1):
        start = re.match(r";\s*start printing object, unique label id:\s*(\d+)\s*$", raw)
        if start:
            current_object = start.group(1)
        if re.match(r";\s*stop printing object", raw):
            current_object = None
        line = raw.split(";", 1)[0].strip().upper()
        if not line:
            continue
        opcode = re.match(r"([GMT])(\d+)(?=\s|[A-Z]|$)", line)
        if not opcode:
            continue
        letter, number = opcode.group(1), int(opcode.group(2))
        params = {k: float(v) for k, v in PARAMETER.findall(line[opcode.end():])}
        if letter == "M" and number in (82, 83):
            relative_e = number == 83
        if letter == "G" and number in (90, 91):
            relative_xy = number == 91
        if letter == "T":
            tool = number if number in (0, 1) else None
            commands.append({"line": line_number, "command": line,
                             "filament_slot_0_based": number, "h_operand": params.get("H")})
        if letter == "G" and number == 92:
            if "E" in params:
                absolute_e = params["E"]
            xy.update({axis: params[axis] for axis in ("X", "Y") if axis in params})
        if letter != "G" or number not in (0, 1, 2, 3):
            continue
        moving = False
        for axis in ("X", "Y"):
            if axis in params:
                target = (xy.get(axis, 0.0) + params[axis]) if relative_xy else params[axis]
                moving |= axis in xy and abs(target - xy[axis]) > 1e-9
                xy[axis] = target
        moving |= number in (2, 3) and any(abs(params.get(axis, 0)) > 1e-9 for axis in ("I", "J"))
        if "E" in params:
            value = params["E"]
            delta = value if relative_e else value - absolute_e
            if not relative_e:
                absolute_e = value
            if number in (1, 2, 3) and delta > 1e-9 and moving and tool is not None and current_object is not None:
                key = (current_object, tool + 1)
                deposits[key] += 1
                examples.setdefault(key, {"line": line_number, "command": line})
    return commands, deposits, examples


def verify(path):
    path = Path(path).resolve(strict=True)
    with zipfile.ZipFile(path) as archive:
        unique = len(archive.namelist()) == len(set(archive.namelist()))
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        slice_info = ET.fromstring(archive.read("Metadata/slice_info.config"))
        if len(slice_info.findall("plate")) != 1 or len(config.findall("plate")) != 1:
            raise ValueError("Verifier requires exactly one plate; multi-plate output is not supported")
        plate = slice_info.find("plate")
        model_plate = config.find("plate")
        plate_metadata = metadata(plate)
        model_plate_metadata = metadata(model_plate)
        index = plate_metadata.get("index", "1")
        if not index.isdigit():
            raise ValueError("Invalid plate index")
        gcode_name = f"Metadata/plate_{index}.gcode"
        gcode_bytes = archive.read(gcode_name)
        checksum = archive.read(gcode_name + ".md5").decode("ascii").strip()
        gcode = gcode_bytes.decode("utf-8-sig")
        filaments = [dict(item.attrib) for item in plate.findall("filament")]
        nozzles = [dict(item.attrib) for item in plate.findall("nozzle")]
    expected = object_slots(config, model_plate)
    commands, deposition, examples = scan_deposition(gcode)
    maps = [int(v) for v in plate_metadata.get("filament_maps", "").split()]
    model_maps = [int(v) for v in model_plate_metadata.get("filament_maps", "").split()]
    # Actual plate mappings override project defaults. The CLI may normalize
    # the global maps to a one-slot Auto For Flush default even in a valid
    # two-nozzle slice; require agreement between both plate metadata sources.
    maps_valid = sorted(maps) == [1, 2] and maps == model_maps
    maps_valid &= model_plate_metadata.get("filament_map_mode") == "Manual"
    used_slots = {int(item["id"]) for item in filaments if float(item.get("used_m", "0")) > 0}
    used_extruders = {int(item["extruder_id"]) for item in nozzles}
    emitted_objects = {item.get("identify_id") for item in plate.findall("object")
                       if item.get("skipped", "false") != "true"}
    labels_in_gcode = set(re.findall(r"^;\s*OBJECT_ID:\s*(\d+)\s*$", gcode, re.MULTILINE))
    physical_deposition = Counter()
    if maps_valid:
        for (_, slot), count in deposition.items():
            physical_deposition[maps[slot - 1]] += count
    checks = {
        "unique_archive_entries": unique,
        "machine_exact_x2d": settings.get("printer_model") == "Bambu Lab X2D",
        "two_0_4_mm_software_nozzles": len(settings.get("nozzle_diameter", [])) == 2 and
            all(float(v) == 0.4 for v in settings["nozzle_diameter"]),
        "slice_metadata_two_0_4_mm_nozzles": len(nozzles) == 2 and
            all(float(n.get("nozzle_diameter", "nan")) == 0.4 for n in nozzles),
        "two_declared_colours": len(settings.get("filament_colour", [])) == 2,
        "two_used_material_slots": used_slots == {1, 2} and len(filaments) == 2,
        "both_materials_used_for_objects": all(n.get("used_for_object") == "true" for n in filaments),
        "both_physical_extruders_in_slice_metadata": used_extruders == {1, 2},
        "explicit_consistent_slot_to_physical_nozzle_maps": maps_valid,
        "dynamic_object_ids_match_slice_metadata": emitted_objects == set(expected),
        "dynamic_object_ids_match_gcode": labels_in_gcode == set(expected),
        "gcode_md5_matches": checksum.lower() == hashlib.md5(gcode_bytes).hexdigest(),
        "actual_material_selection_commands": {c["filament_slot_0_based"] for c in commands} >= {0, 1},
        "each_object_deposits_its_assigned_material": all(deposition[(label, slot)] > 0 for label, slot in expected.items()),
        "no_cross_assigned_object_deposition": all(label in expected and expected[label] == slot for label, slot in deposition),
        "both_mapped_physical_nozzles_deposit_on_objects": set(physical_deposition) == {1, 2},
    }
    return {"file_name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "checks": checks, "all_passed": all(checks.values()),
            "failures": [name for name, passed in checks.items() if not passed],
            "expected_object_material_slots_1_based": expected,
            "material_to_physical_nozzle_1_based": maps,
            "object_deposition_move_counts": {f"object_{label}_material_{slot}": count for (label, slot), count in deposition.items()},
            "deposition_examples": {f"object_{label}_material_{slot}": example for (label, slot), example in examples.items()},
            "physical_nozzle_deposition_move_counts": dict(physical_deposition),
            "material_selection_commands": commands[:20], "material_selection_command_count": len(commands),
            "evidence_scope": "Offline sliced-file consistency only; T selects material and filament_maps assigns physical nozzles.",
            "physical_nozzles_verified": False, "printing_started": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.file)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        result = {"all_passed": False, "error": str(error), "evidence_scope": "Offline file verification failed"}
    rendered = json.dumps(result, indent=2)
    if args.receipt:
        # Do not silently replace earlier evidence.
        with args.receipt.open("x", encoding="utf-8") as stream:
            stream.write(rendered + "\n")
    print(rendered)
    raise SystemExit(0 if result["all_passed"] else 1)


if __name__ == "__main__":
    main()
