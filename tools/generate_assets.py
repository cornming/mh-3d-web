import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "models"


def material(name, color, roughness=0.6, metallic=0.0, emission=None):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission:
        emission_socket = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        if emission_socket:
            emission_socket.default_value = (*emission, 1.0)
            shader.inputs["Emission Strength"].default_value = 2.5
    return result


def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj


def parent(obj, parent_obj):
    obj.parent = parent_obj
    return obj


def finish(obj, mat=None, bevel=0.0):
    if mat:
        assign(obj, mat)
    if bevel:
        modifier = obj.modifiers.new("EdgeSoftness", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    return obj


def ico(name, location, scale, mat, parent_obj=None, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, mat)
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def cube(name, location, dimensions, mat, parent_obj=None, bevel=0.0, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    if rotation:
        obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, mat, bevel)
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def cylinder(name, location, radius, depth, mat, parent_obj=None, rotation=None, vertices=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    finish(obj, mat)
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def cone(name, location, radius, depth, mat, parent_obj=None, rotation=None, vertices=8):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0.04, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    finish(obj, mat)
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def empty(name, location, parent_obj=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def export(filepath):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format="GLB",
        export_apply=True,
        export_animations=False,
        export_materials="EXPORT",
    )


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.world = bpy.data.worlds.new("AssetWorld")
    scene.world.color = (0.015, 0.02, 0.02)


def create_hunter():
    reset()
    chitin = material("Hunter Chitin", (0.12, 0.18, 0.17), roughness=0.42, metallic=0.18)
    leather = material("Hunter Leather", (0.16, 0.08, 0.045), roughness=0.8)
    bone = material("Hunter Bone", (0.76, 0.58, 0.32), roughness=0.48)
    steel = material("Hunter Metal", (0.28, 0.34, 0.34), roughness=0.23, metallic=0.82)
    ember = material("Hunter Ember", (0.72, 0.15, 0.025), roughness=0.35, emission=(0.72, 0.08, 0.01))

    root = empty("HunterRoot", (0.0, 0.0, 0.0))
    ico("chest", (0.0, 1.25, 0.0), (0.72, 0.95, 0.48), chitin, root)
    cube("chest_plate", (0.0, 1.43, 0.43), (0.9, 0.72, 0.16), bone, root, bevel=0.08, rotation=(math.radians(-8), 0.0, 0.0))
    ico("back_shell", (0.0, 1.42, -0.35), (0.66, 0.8, 0.28), leather, root)

    for side in (-1, 1):
        x = side * 0.55
        ico(f"leg_{side}", (x * 0.62, 0.62, 0.0), (0.28, 0.72, 0.3), leather, root)
        cube(f"knee_{side}", (x * 0.62, 0.92, 0.25), (0.34, 0.3, 0.22), bone, root, bevel=0.05)
        ico(f"shoulder_{side}", (x, 1.88, 0.0), (0.38, 0.28, 0.42), bone, root)
        cylinder(f"arm_{side}", (x * 1.04, 1.47, 0.08), 0.18, 0.7, leather, root, rotation=(0.0, 0.0, math.radians(side * 16)))
        cone(f"shoulder_spike_{side}", (x * 1.15, 2.1, 0.05), 0.18, 0.7, bone, root, rotation=(0.0, math.radians(side * -20), 0.0))

    head = ico("head", (0.0, 2.48, 0.02), (0.45, 0.48, 0.42), leather, root)
    cube("helmet_front", (0.0, 2.47, 0.37), (0.58, 0.42, 0.18), bone, root, bevel=0.06, rotation=(math.radians(-8), 0.0, 0.0))
    for side in (-1, 1):
        cone(f"helmet_horn_{side}", (side * 0.27, 2.85, 0.08), 0.12, 0.68, bone, root, rotation=(math.radians(-16), math.radians(side * 20), 0.0))
    ico("visor", (0.0, 2.5, 0.48), (0.28, 0.08, 0.06), ember, root)

    weapon = empty("weaponPivot", (0.72, 1.28, 0.05), root)
    cylinder("weapon_grip", (0.0, 0.34, 0.0), 0.1, 0.7, leather, weapon, rotation=(math.pi / 2, 0.0, 0.0))
    cube("weapon_guard", (0.0, 0.76, 0.0), (0.88, 0.13, 0.2), bone, weapon, bevel=0.05)
    cube("weapon_blade", (0.0, 2.08, 0.0), (0.3, 2.55, 0.14), steel, weapon, bevel=0.08)
    cone("weapon_tip", (0.0, 3.45, 0.0), 0.2, 0.62, bone, weapon)
    ico("weapon_gem", (0.0, 0.86, 0.11), (0.08, 0.08, 0.04), ember, weapon)

    export(OUTPUT / "hunter.glb")


def create_monster():
    reset()
    hide = material("Hide", (0.18, 0.055, 0.035), roughness=0.72)
    chitin = material("Chitin", (0.24, 0.12, 0.055), roughness=0.43, metallic=0.12)
    bone = material("Bone", (0.68, 0.47, 0.21), roughness=0.52)
    wing = material("Wing Membrane", (0.12, 0.055, 0.03), roughness=0.88)
    eye = material("Eye", (0.78, 0.12, 0.015), roughness=0.24, emission=(0.95, 0.05, 0.005))

    root = empty("MonsterRoot", (0.0, 0.0, 0.0))
    ico("body", (0.0, 2.35, 0.0), (2.15, 1.55, 3.35), hide, root, subdivisions=2)
    ico("shoulder_shell", (0.0, 3.05, 1.15), (1.85, 0.58, 1.35), chitin, root)
    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        ico(f"shoulder_plate_{side_name}", (side * 1.55, 3.1, 1.0), (0.8, 0.55, 1.05), chitin, root)
        cylinder(f"front_leg_{side_name}", (side * 1.45, 1.25, 1.35), 0.42, 2.0, hide, root, rotation=(math.radians(side * 10), 0.0, math.radians(side * 18)))
        cone(f"front_claw_{side_name}", (side * 1.5, 0.2, 2.0), 0.38, 1.25, bone, root, rotation=(math.radians(-28), math.radians(side * 8), 0.0))
        cylinder(f"hind_leg_{side_name}", (side * 1.35, 1.0, -1.85), 0.5, 2.25, hide, root, rotation=(math.radians(side * 20), 0.0, math.radians(side * -12)))
        cone(f"hind_claw_{side_name}", (side * 1.55, 0.22, -2.55), 0.44, 1.35, bone, root, rotation=(math.radians(-35), math.radians(side * 8), 0.0))

    head = empty("head", (0.0, 3.25, 4.35), root)
    ico("head_plates", (0.0, 0.0, 0.0), (1.52, 1.15, 1.55), chitin, head, subdivisions=1)
    ico("jaw", (0.0, -0.62, 0.75), (1.05, 0.42, 0.95), hide, head)
    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        cone(f"horn_{side_name}", (side * 0.88, 0.8, 0.2), 0.36, 2.3, bone, head, rotation=(math.radians(-32), math.radians(side * -24), 0.0), vertices=6)
        ico(f"eye_{side_name}", (side * 0.72, 0.06, 1.28), (0.18, 0.13, 0.08), eye, head)
        for tooth in range(3):
            cone(f"tooth_{side_name}_{tooth}", (side * (0.45 + tooth * 0.28), -0.78, 1.05 + tooth * 0.12), 0.09, 0.42, bone, head, rotation=(math.pi, 0.0, 0.0), vertices=6)

    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        wing_root = empty(f"wing_{side_name}", (side * 2.0, 3.0, 0.7), root)
        cube(f"wing_membrane_{side_name}", (side * 1.55, 0.2, 0.0), (2.6, 0.18, 2.9), wing, wing_root, bevel=0.08, rotation=(0.0, math.radians(side * 18), math.radians(side * 8)))
        cone(f"wing_bone_{side_name}", (side * 2.65, 0.0, 0.1), 0.15, 3.8, bone, wing_root, rotation=(0.0, math.radians(side * 70), 0.0), vertices=6)

    tail = empty("tail", (0.0, 2.0, -4.0), root)
    for index in range(4):
        scale = 0.72 - index * 0.13
        ico(f"tail_segment_{index}", (0.0, 0.0, -index * 1.25), (scale, scale, 1.35), hide, tail)
    cone("tail_spike", (0.0, 0.0, -5.7), 0.35, 1.5, bone, tail, rotation=(math.pi, 0.0, 0.0), vertices=6)

    export(OUTPUT / "monster.glb")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    create_hunter()
    create_monster()
    print(f"Generated assets in {OUTPUT}")


if __name__ == "__main__":
    main()
