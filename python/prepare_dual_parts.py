# SPDX-License-Identifier: GPL-2.0-only
"""Build an offline X2D project from two closed STL files and a local template.

No vendor presets, printer credentials or GUI integration are bundled. The local
template supplies machine/process settings, including official G-code templates.
Only the 0.4/0.4 mm software baseline and rectangular printable areas are supported.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
import trimesh

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0"
MATRIX = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"
ET.register_namespace("", CORE)


def metadata(node):
    return {item.get("key"): item.get("value") for item in node.findall("metadata")}


def add_metadata(node, key, value):
    ET.SubElement(node, "metadata", {"key": key, "value": str(value)})


def validate_baseline(settings):
    if settings.get("printer_model") != "Bambu Lab X2D":
        raise ValueError("Template must declare printer_model Bambu Lab X2D")
    sizes = settings.get("nozzle_diameter")
    if not isinstance(sizes, list) or len(sizes) != 2 or any(float(v) != 0.4 for v in sizes):
        raise ValueError("Only the two-nozzle 0.4/0.4 mm X2D software baseline is supported")
    for key in ("filament_type", "filament_colour"):
        if not isinstance(settings.get(key), list) or len(settings[key]) != 2:
            raise ValueError(f"Template must contain exactly two {key} entries")


def common_volume(settings):
    areas = []
    for polygon in settings.get("extruder_printable_area", []):
        vertices = np.asarray([[float(v) for v in point.split("x")]
                               for point in polygon.split(",")], dtype=float)
        if vertices.ndim != 2 or vertices.shape[1] != 2 or not np.isfinite(vertices).all():
            raise ValueError("Invalid extruder_printable_area")
        bounds = np.asarray([vertices.min(axis=0), vertices.max(axis=0)])
        corners = {(bounds[ix, 0], bounds[iy, 1]) for ix in (0, 1) for iy in (0, 1)}
        if len(corners) != 4 or set(map(tuple, vertices)) != corners:
            raise ValueError("Only rectangular X2D nozzle areas are supported")
        areas.append(bounds)
    heights = [float(v) for v in settings.get("extruder_printable_height", [])]
    if len(areas) != 2 or len(heights) != 2 or not all(np.isfinite(v) and v > 0 for v in heights):
        raise ValueError("Exactly two valid nozzle areas and heights are required")
    result = np.asarray([[max(a[0, 0] for a in areas), max(a[0, 1] for a in areas), 0.0],
                         [min(a[1, 0] for a in areas), min(a[1, 1] for a in areas), min(heights)]])
    if np.any(result[1] <= result[0]):
        raise ValueError("No common two-nozzle print volume")
    return result


def load_part(path):
    path = Path(path).resolve(strict=True)
    if path.suffix.lower() != ".stl":
        raise ValueError("Both part inputs must be STL files")
    mesh = trimesh.load_mesh(path, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise ValueError(f"Empty or non-mesh input: {path.name}")
    if not np.isfinite(mesh.vertices).all():
        raise ValueError(f"Non-finite vertices: {path.name}")
    mesh.merge_vertices()
    if not mesh.is_watertight or not mesh.is_winding_consistent:
        raise ValueError(f"Closed consistently wound mesh required: {path.name}")
    if not np.isfinite(mesh.volume) or abs(mesh.volume) < 1e-9:
        raise ValueError(f"Non-zero solid volume required: {path.name}")
    if mesh.volume < 0:
        mesh.invert()
    return path, mesh


def mesh_xml(mesh):
    node = ET.Element(f"{{{CORE}}}mesh")
    vertices = ET.SubElement(node, f"{{{CORE}}}vertices")
    for point in mesh.vertices:
        ET.SubElement(vertices, f"{{{CORE}}}vertex", dict(zip(("x", "y", "z"),
                      (format(float(v), ".12g") for v in point))))
    triangles = ET.SubElement(node, f"{{{CORE}}}triangles")
    for face in mesh.faces:
        ET.SubElement(triangles, f"{{{CORE}}}triangle", dict(zip(("v1", "v2", "v3"),
                      (str(int(v)) for v in face))))
    return node


def build_project(template, part1, part2, output, filament1, filament2,
                  colour1="#00AE42", colour2="#FFFFFF", layout="shared"):
    template = Path(template).resolve(strict=True)
    output = Path(output).resolve()
    if template.suffix.lower() != ".3mf" or output.suffix.lower() != ".3mf":
        raise ValueError("Template and output filenames must end with .3mf")
    colours = [colour1.upper(), colour2.upper()]
    if any(not re.fullmatch(r"#[0-9A-F]{6}", c) for c in colours):
        raise ValueError("Colours must use #RRGGBB")
    if layout not in ("shared", "separate"):
        raise ValueError("Layout must be shared or separate")
    profile_paths = [Path(p).resolve(strict=True) for p in (filament1, filament2)]
    for profile in profile_paths:
        if ";" in str(profile) or profile.suffix.lower() != ".json":
            raise ValueError("Filament profiles must be JSON paths without semicolons")
        if not isinstance(json.loads(profile.read_text(encoding="utf-8-sig")), dict):
            raise ValueError("Filament profile JSON must be an object")
    request_path = output.with_suffix(".mcp.json")
    receipt_path = output.with_suffix(".receipt.json")
    for target in (output, request_path, receipt_path):
        if target.exists():
            raise FileExistsError(f"Refusing to overwrite: {target.name}")
    with zipfile.ZipFile(template) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())):
            raise ValueError("Duplicate template archive entries")
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        old_config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        old_model = ET.fromstring(archive.read("3D/3dmodel.model"))
    validate_baseline(settings)
    volume = common_volume(settings)
    plates = old_config.findall("plate")
    if len(plates) != 1:
        raise ValueError("Template must have exactly one plate")
    plate_info = metadata(plates[0])
    maps = [int(v) for v in plate_info.get("filament_maps", "").split()]
    if sorted(maps) != [1, 2] or plate_info.get("filament_map_mode") != "Manual":
        raise ValueError("Template plate needs a Manual filament_maps assignment using both physical nozzles 1 and 2")
    # Per-plate assignments override global defaults in saved Bambu projects.
    # A global Manual assignment, if present, must not conflict. Auto defaults
    # are normalized by the slicer and are not physical assignment evidence.
    if settings.get("filament_map_mode") == "Manual":
        for key in ("filament_map", "filament_map_2"):
            if key in settings and [int(v) for v in settings[key]] != maps:
                raise ValueError(f"Conflicting template plate and {key}")
    # Generate new IDs from template metadata, never assume IDs 1/2 or labels 15/16.
    old_ids = [int(n.get("id")) for n in old_model.findall(f".//{{{CORE}}}object")]
    old_ids += [int(n.get("id")) for n in old_config.findall("object")]
    first_id = max(old_ids, default=0) + 1
    old_labels = [int(metadata(n)["identify_id"]) for n in plates[0].findall("model_instance")
                  if "identify_id" in metadata(n)]
    first_label = max(old_labels, default=0) + 1
    loaded = [load_part(p) for p in (part1, part2)]
    meshes = [mesh for _, mesh in loaded]
    originals = [m.bounds.copy() for m in meshes]
    if layout == "separate":
        cursor = 0.0
        for mesh in meshes:
            bounds = mesh.bounds.copy()
            mesh.apply_translation([cursor - bounds[0, 0], -bounds[0, 1], -bounds[0, 2]])
            cursor += mesh.extents[0] + 10.0
    combined = np.asarray([np.min([m.bounds[0] for m in meshes], axis=0),
                           np.max([m.bounds[1] for m in meshes], axis=0)])
    dimensions = combined[1] - combined[0]
    if np.any(dimensions > volume[1] - volume[0] + 1e-7):
        raise ValueError("Joint model dimensions exceed the common two-nozzle volume")
    translation = np.asarray([*(volume.mean(axis=0)[:2] - combined.mean(axis=0)[:2]), -combined[0, 2]])
    for mesh in meshes:
        mesh.apply_translation(translation)
    settings["filament_colour"] = colours
    # Preserve machine/process settings, including official G-code templates.
    # Make the chosen per-plate assignment explicit in the new project defaults.
    settings["filament_map"] = [str(v) for v in maps]
    settings["filament_map_2"] = [str(v) for v in maps]
    settings["filament_map_mode"] = "Manual"
    model = ET.Element(f"{{{CORE}}}model", {"unit": "millimeter", "xml:lang": "en-US",
                       "xmlns:BambuStudio": "http://schemas.bambulab.com/package/2021"})
    ET.SubElement(model, f"{{{CORE}}}metadata", {"name": "Application"}).text = "Bambu Headless Bridge"
    ET.SubElement(model, f"{{{CORE}}}metadata", {"name": "BambuStudio:3mfVersion"}).text = "1"
    resources = ET.SubElement(model, f"{{{CORE}}}resources")
    build = ET.SubElement(model, f"{{{CORE}}}build")
    config = ET.Element("config")
    # Per-part geometry settings are regenerated to avoid stale transforms,
    # painted facets, source paths, supports and object IDs from old meshes.
    for slot, (_, mesh) in enumerate(loaded, 1):
        object_id = first_id + slot - 1
        obj = ET.SubElement(resources, f"{{{CORE}}}object", {"id": str(object_id), "type": "model"})
        obj.append(mesh_xml(mesh))
        ET.SubElement(build, f"{{{CORE}}}item", {"objectid": str(object_id), "transform": IDENTITY, "printable": "1"})
        info = ET.SubElement(config, "object", {"id": str(object_id)})
        add_metadata(info, "name", f"part_{slot}")
        add_metadata(info, "extruder", slot)  # Bambu object field = material slot, not physical nozzle.
        part = ET.SubElement(info, "part", {"id": str(object_id), "subtype": "normal_part"})
        for key, value in (("name", f"part_{slot}"), ("matrix", MATRIX), ("extruder", slot)):
            add_metadata(part, key, value)
        ET.SubElement(part, "mesh_stat", {"face_count": str(len(mesh.faces)), "edges_fixed": "0",
                      "degenerate_facets": "0", "facets_removed": "0", "facets_reversed": "0", "backwards_edges": "0"})
    plate = ET.SubElement(config, "plate")
    for key, value in (("plater_id", "1"), ("plater_name", "Dual-nozzle offline project"),
                       ("locked", "false"), ("filament_map_mode", "Manual"),
                       ("filament_maps", " ".join(map(str, maps))), ("filament_volume_maps", "0 0")):
        add_metadata(plate, key, value)
    for offset in range(2):
        instance = ET.SubElement(plate, "model_instance")
        for key, value in (("object_id", first_id + offset), ("instance_id", 0), ("identify_id", first_label + offset)):
            add_metadata(instance, key, value)
    request = {"stl_path": str(output), "bambu_model": "x2d", "slicer_type": "bambustudio",
               "template_3mf_path": str(output), "load_filaments": ";".join(map(str, profile_paths)),
               "filament_colours": ";".join(colours), "use_printer_filaments": False,
               "nozzle_diameter": "0.4", "arrange": False, "orient": False}
    types = ('<?xml version="1.0" encoding="utf-8"?>'
             '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
             '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
             '<Default Extension="config" ContentType="application/octet-stream"/></Types>')
    rels = ('<?xml version="1.0" encoding="utf-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
            'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("3D/3dmodel.model", ET.tostring(model, encoding="utf-8", xml_declaration=True))
        archive.writestr("Metadata/project_settings.config", json.dumps(settings, indent=2))
        archive.writestr("Metadata/model_settings.config", ET.tostring(config, encoding="utf-8", xml_declaration=True))
    with request_path.open("x", encoding="utf-8") as stream:
        json.dump(request, stream, indent=2)
    receipt = {"output_name": output.name, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
               "template_sha256": hashlib.sha256(template.read_bytes()).hexdigest(), "layout": layout,
               "units": "mm", "joint_dimensions": dimensions.tolist(),
               "common_nozzle_volume": volume.tolist(), "joint_translation": translation.tolist(),
               "relative_position_preserved": layout == "shared", "colours_declared": colours,
               "filament_to_physical_nozzle_1_based": maps, "software_nozzle_baseline_mm": [0.4, 0.4],
               "parts": [{"name": f"part_{slot}", "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                          "object_id": first_id + slot - 1, "identify_id": first_label + slot - 1,
                          "faces": len(mesh.faces), "original_bounds": bounds.tolist(), "placed_bounds": mesh.bounds.tolist(),
                          "filament_slot_1_based": slot, "physical_nozzle_1_based": maps[slot - 1]}
                         for slot, ((path, mesh), bounds) in enumerate(zip(loaded, originals), 1)],
               "physical_nozzles_verified": False, "sliced": False, "printing_started": False}
    with receipt_path.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("template", "part1", "part2", "output", "filament1", "filament2"):
        parser.add_argument("--" + flag, type=Path, required=True)
    parser.add_argument("--colour1", default="#00AE42")
    parser.add_argument("--colour2", default="#FFFFFF")
    parser.add_argument("--layout", choices=("shared", "separate"), default="shared")
    args = parser.parse_args()
    try:
        receipt = build_project(**vars(args))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        parser.exit(1, f"Project preparation failed: {error}\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
