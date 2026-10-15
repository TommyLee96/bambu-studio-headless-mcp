# SPDX-License-Identifier: GPL-2.0-only
"""Original synthetic fixtures. No vendor profile or user project is included."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from prepare_dual_parts import CORE, build_project, load_part  # noqa: E402
from verify_dual import scan_deposition, verify  # noqa: E402

spec = importlib.util.spec_from_file_location("sample_parts", ROOT / "examples" / "make_sample_parts.py")
sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sample)


def template_settings(maps=(1, 2)):
    # Minimal invented schema fixture; deliberately not a usable machine preset.
    return {"printer_model": "Bambu Lab X2D", "nozzle_diameter": ["0.4", "0.4"],
            "extruder_printable_area": ["0x0,100x0,100x100,0x100", "10x0,100x0,100x100,10x100"],
            "extruder_printable_height": ["100", "90"],
            "filament_type": ["PLA", "PLA"], "filament_colour": ["#123456", "#ABCDEF"],
            "filament_map": list(map(str, maps)), "filament_map_2": list(map(str, maps)),
            "filament_map_mode": "Manual", "machine_start_gcode": "; synthetic marker: retained verbatim"}


def write_template(path, settings=None, maps=(1, 2)):
    config = ('<config><object id="19"/><object id="71"/><plate>'
              '<metadata key="filament_map_mode" value="Manual"/>'
              '<metadata key="filament_maps" value="' + " ".join(map(str, maps)) + '"/>'
              '<model_instance><metadata key="identify_id" value="93"/></model_instance></plate></config>')
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("Metadata/project_settings.config", json.dumps(settings or template_settings(maps)))
        archive.writestr("Metadata/model_settings.config", config)
        archive.writestr("3D/3dmodel.model", f'<model xmlns="{CORE}"><resources><object id="71"/></resources></model>')


def sliced_file(path, *, maps=(1, 2), wrong_material=False, purge_only=False,
                one_nozzle=False, wrong_checksum=False, metadata_maps=None, normalized_defaults=False):
    settings = template_settings(maps)
    if normalized_defaults:
        settings.update(filament_map=["1"], filament_map_2=["1"], filament_map_mode="Auto For Flush")
    model = '<config>'
    for object_id, slot in ((37, 1), (84, 2)):
        model += (f'<object id="{object_id}"><metadata key="extruder" value="{slot}"/>'
                  f'<part id="{object_id}" subtype="normal_part"/></object>')
    model += '<plate><metadata key="filament_map_mode" value="Manual"/><metadata key="filament_maps" value="' + " ".join(map(str, maps)) + '"/>'
    for object_id, label in ((37, 801), (84, 902)):
        model += (f'<model_instance><metadata key="object_id" value="{object_id}"/>'
                  f'<metadata key="identify_id" value="{label}"/></model_instance>')
    model += '</plate></config>'
    info = '<config><plate><metadata key="index" value="1"/>'
    info += '<metadata key="filament_maps" value="' + " ".join(map(str, metadata_maps or maps)) + '"/>'
    for label in (801, 902):
        info += f'<object identify_id="{label}" skipped="false"/>'
    for slot in (1, 2):
        info += f'<filament id="{slot}" used_m="0.1" used_for_object="true"/>'
    for nozzle in ((1,) if one_nozzle else (1, 2)):
        info += f'<nozzle extruder_id="{nozzle}" nozzle_diameter="0.4"/>'
    info += '</plate></config>'
    gcode = '; OBJECT_ID: 801\n; OBJECT_ID: 902\nG90\nM83\nG1 X0 Y0\n'
    for label, slot in ((801, 0), (902, 0 if wrong_material else 1)):
        gcode += f'T{slot} H-1\n'
        if not purge_only:
            gcode += f'; start printing object, unique label id: {label}\n'
        gcode += 'G1X1Y1E0.1\nG1 X2 Y2 E0.1\n'
        if not purge_only:
            gcode += '; stop printing object\n'
        gcode += 'G1 X0 Y0\n'
    raw = gcode.encode()
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("Metadata/project_settings.config", json.dumps(settings))
        archive.writestr("Metadata/model_settings.config", model)
        archive.writestr("Metadata/slice_info.config", info)
        archive.writestr("Metadata/plate_1.gcode", raw)
        archive.writestr("Metadata/plate_1.gcode.md5", "0" * 32 if wrong_checksum else hashlib.md5(raw).hexdigest())


class BuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.template = self.directory / "local.3mf"
        write_template(self.template)
        self.parts = [self.directory / f"part{n}.stl" for n in (1, 2)]
        for path, x in zip(self.parts, (0, 12)):
            path.write_text(sample.cube_stl(x=x), encoding="ascii")
        self.profiles = [self.directory / f"material{n}.json" for n in (1, 2)]
        for path in self.profiles:
            path.write_text('{"type":"filament","name":"synthetic"}', encoding="utf-8")
        self.output = self.directory / "project.3mf"

    def build(self, **options):
        return build_project(self.template, *self.parts, self.output, *self.profiles, **options)

    def test_closed_original_samples(self):
        for path in self.parts:
            _, mesh = load_part(path)
            self.assertTrue(mesh.is_watertight)
            self.assertEqual(mesh.volume, 512.0)

    def test_shared_placement_dynamic_ids_and_offline_sidecar(self):
        receipt = self.build()
        self.assertEqual([p["object_id"] for p in receipt["parts"]], [72, 73])
        self.assertEqual([p["identify_id"] for p in receipt["parts"]], [94, 95])
        placed = [p["placed_bounds"][0] for p in receipt["parts"]]
        self.assertEqual(placed[1][0] - placed[0][0], 12.0)
        self.assertEqual(placed[1][2] - placed[0][2], 0.0)
        self.assertTrue(receipt["relative_position_preserved"])
        self.assertNotIn(str(self.directory), json.dumps(receipt))
        request = json.loads(self.output.with_suffix(".mcp.json").read_text())
        self.assertFalse(request["use_printer_filaments"])
        self.assertFalse(request["arrange"])
        self.assertFalse(request["orient"])
        self.assertEqual(request["template_3mf_path"], str(self.output.resolve()))
        self.assertEqual(request["load_filaments"], ";".join(map(str, self.profiles)))
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(len(archive.namelist()), 5)
            settings = json.loads(archive.read("Metadata/project_settings.config"))
            self.assertEqual(settings["machine_start_gcode"], template_settings()["machine_start_gcode"])
            config = ET.fromstring(archive.read("Metadata/model_settings.config"))
            self.assertEqual([p.get("id") for p in config.findall("object")], ["72", "73"])

    def test_reversed_physical_mapping_is_preserved(self):
        write_template(self.template, maps=(2, 1))
        receipt = self.build()
        self.assertEqual(receipt["filament_to_physical_nozzle_1_based"], [2, 1])
        self.assertEqual([p["physical_nozzle_1_based"] for p in receipt["parts"]], [2, 1])

    def test_authoritative_plate_overrides_global_auto_defaults(self):
        settings = template_settings()
        settings.update(filament_map=["1"], filament_map_2=["1"], filament_map_mode="Auto For Flush")
        write_template(self.template, settings)
        self.assertEqual(self.build()["filament_to_physical_nozzle_1_based"], [1, 2])

    def test_rejects_other_machine(self):
        settings = template_settings()
        settings["printer_model"] = "Bambu Lab A1"
        write_template(self.template, settings)
        with self.assertRaisesRegex(ValueError, "Bambu Lab X2D"):
            self.build()

    def test_rejects_unvalidated_nozzles(self):
        settings = template_settings()
        settings["nozzle_diameter"] = ["0.4", "0.6"]
        write_template(self.template, settings)
        with self.assertRaisesRegex(ValueError, "0.4/0.4"):
            self.build()

    def test_rejects_conflicting_physical_map(self):
        settings = template_settings()
        settings["filament_map_2"] = ["2", "1"]
        write_template(self.template, settings)
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            self.build()

    def test_rejects_open_mesh(self):
        text = sample.cube_stl()
        first_facet = text.index("  facet")
        next_facet = text.index("  facet", first_facet + 1)
        self.parts[0].write_text(text[:first_facet] + text[next_facet:], encoding="ascii")
        with self.assertRaisesRegex(ValueError, "Closed"):
            self.build()

    def test_rejects_oversized_and_never_overwrites(self):
        self.parts[0].write_text(sample.cube_stl(size=120), encoding="ascii")
        with self.assertRaisesRegex(ValueError, "exceed"):
            self.build()
        self.assertFalse(self.output.exists())
        self.output.write_bytes(b"do not replace")
        with self.assertRaises(FileExistsError):
            self.build()
        self.assertEqual(self.output.read_bytes(), b"do not replace")

    def test_separate_is_explicit(self):
        receipt = self.build(layout="separate")
        self.assertFalse(receipt["relative_position_preserved"])
        placed = [p["placed_bounds"][0] for p in receipt["parts"]]
        self.assertEqual(placed[1][0] - placed[0][0], 18)


class VerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "slice.3mf"

    def test_dynamic_object_ids_actual_deposition(self):
        sliced_file(self.path)
        result = verify(self.path)
        self.assertTrue(result["all_passed"], result["failures"])
        self.assertEqual(result["expected_object_material_slots_1_based"], {"801": 1, "902": 2})

    def test_material_is_not_physical_nozzle(self):
        sliced_file(self.path, maps=(2, 1))
        result = verify(self.path)
        self.assertTrue(result["all_passed"], result["failures"])
        self.assertEqual(result["material_to_physical_nozzle_1_based"], [2, 1])
        self.assertEqual(set(result["physical_nozzle_deposition_move_counts"]), {1, 2})

    def test_slicer_normalized_global_defaults_are_not_actual_plate_maps(self):
        sliced_file(self.path, maps=(2, 1), normalized_defaults=True)
        result = verify(self.path)
        self.assertTrue(result["all_passed"], result["failures"])
        self.assertEqual(result["material_to_physical_nozzle_1_based"], [2, 1])

    def test_cross_assigned_material_is_rejected(self):
        sliced_file(self.path, wrong_material=True)
        result = verify(self.path)
        self.assertFalse(result["all_passed"])
        self.assertIn("no_cross_assigned_object_deposition", result["failures"])

    def test_purge_alone_does_not_prove_object_deposition(self):
        sliced_file(self.path, purge_only=True)
        result = verify(self.path)
        self.assertFalse(result["all_passed"])
        self.assertEqual(result["object_deposition_move_counts"], {})

    def test_missing_nozzle_and_corrupt_md5_are_rejected(self):
        sliced_file(self.path, one_nozzle=True, wrong_checksum=True)
        result = verify(self.path)
        self.assertFalse(result["all_passed"])
        self.assertIn("both_physical_extruders_in_slice_metadata", result["failures"])
        self.assertIn("gcode_md5_matches", result["failures"])

    def test_conflicting_model_plate_and_slice_maps_are_rejected(self):
        sliced_file(self.path, metadata_maps=(2, 1))
        result = verify(self.path)
        self.assertFalse(result["all_passed"])
        self.assertIn("explicit_consistent_slot_to_physical_nozzle_maps", result["failures"])

    def test_absolute_e_resets_and_sentinel_tool(self):
        _, counts, _ = scan_deposition('G90\nM82\nG1 X0 Y0\nT0 H-1\n'
            '; start printing object, unique label id: 200\nG92 E0\nG1 X1 E0.2\n'
            'G1 X2 E0.1\nG92 E0\nG1 X3 E0.1\nT1000\nG1 X4 E0.2\n')
        self.assertEqual(counts, {("200", 1): 2})

    def test_compact_xy_and_e_are_not_confused_with_exponents(self):
        _, counts, _ = scan_deposition('G90\nM83\nG1 X0 Y0\nT1\n'
            '; start printing object, unique label id: 77\nG1X1Y1E0.1\n')
        self.assertEqual(counts, {("77", 2): 1})


if __name__ == "__main__":
    unittest.main()
