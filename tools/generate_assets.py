import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "models"


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def surface_texture(name, color, seed):
    """Create a small packed color texture so GLB keeps visible surface variation."""
    size = 256
    image = bpy.data.images.new(f"{name} Surface", width=size, height=size, alpha=False)
    pixels = []
    for y in range(size):
        v = y / (size - 1)
        for x in range(size):
            u = x / (size - 1)
            broad = math.sin((u * 5.2 + seed) * math.tau) * math.cos((v * 4.1 + seed * 0.7) * math.tau)
            grain = math.sin((u * 31.0 + v * 23.0 + seed * 2.0) * math.tau)
            value = clamp(0.86 + broad * 0.075 + grain * 0.035)
            warm = math.sin((u * 7.0 - v * 5.0 + seed) * math.tau) * 0.018
            linear_color = (
                clamp(color[0] * value + warm),
                clamp(color[1] * value + warm * 0.55),
                clamp(color[2] * value),
            )
            # Blender 的材質顏色是線性值，影像貼圖則需要以 sRGB 編碼寫入，
            # 否則深色皮革與甲殼在 WebGL 中會被錯誤壓成接近黑色。
            pixels.extend((
                linear_color[0] ** (1.0 / 2.2),
                linear_color[1] ** (1.0 / 2.2),
                linear_color[2] ** (1.0 / 2.2),
                1.0,
            ))
    image.pixels = pixels
    image.pack()
    return image


def surface_normal_texture(name, seed):
    """Create a packed tangent-space normal texture from the same procedural grain."""
    size = 256
    image = bpy.data.images.new(f"{name} Normal", width=size, height=size, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    pixels = []

    def height_at(u, v):
        broad = math.sin((u * 5.2 + seed) * math.tau) * math.cos((v * 4.1 + seed * 0.7) * math.tau)
        grain = math.sin((u * 31.0 + v * 23.0 + seed * 2.0) * math.tau)
        return broad * 0.07 + grain * 0.025

    for y in range(size):
        v = y / (size - 1)
        for x in range(size):
            u = x / (size - 1)
            step = 1.0 / size
            dx = (height_at(u + step, v) - height_at(u - step, v)) * 1.8
            dy = (height_at(u, v + step) - height_at(u, v - step)) * 1.8
            nx, ny, nz = -dx, -dy, 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            pixels.extend((
                nx / length * 0.5 + 0.5,
                ny / length * 0.5 + 0.5,
                nz / length * 0.5 + 0.5,
                1.0,
            ))
    image.pixels = pixels
    image.pack()
    return image


def surface_roughness_texture(name, seed, base_roughness):
    """Create subtle roughness variation so surfaces do not reflect uniformly."""
    size = 256
    image = bpy.data.images.new(f"{name} Roughness", width=size, height=size, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    pixels = []
    for y in range(size):
        v = y / (size - 1)
        for x in range(size):
            u = x / (size - 1)
            broad = math.sin((u * 4.7 + seed * 0.8) * math.tau) * math.cos((v * 3.9 - seed) * math.tau)
            grain = math.sin((u * 29.0 - v * 21.0 + seed * 1.6) * math.tau)
            value = clamp(base_roughness + broad * 0.075 + grain * 0.035, 0.08, 1.0)
            pixels.extend((value, value, value, 1.0))
    image.pixels = pixels
    image.pack()
    return image


def material(name, color, roughness=0.6, metallic=0.0, emission=None, textured=True):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if textured:
        seed = (sum(ord(character) for character in name) % 97) / 97.0
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = f"{name} Texture"
        texture.image = surface_texture(name, color, seed)
        texture.interpolation = "Linear"
        links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        normal_texture = nodes.new("ShaderNodeTexImage")
        normal_texture.name = f"{name} Normal Texture"
        normal_texture.image = surface_normal_texture(name, seed)
        normal_texture.interpolation = "Linear"
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = 0.3
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
        roughness_texture = nodes.new("ShaderNodeTexImage")
        roughness_texture.name = f"{name} Roughness Texture"
        roughness_texture.image = surface_roughness_texture(name, seed, roughness)
        roughness_texture.interpolation = "Linear"
        links.new(roughness_texture.outputs["Color"], shader.inputs["Roughness"])
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


def finish(obj, mat=None, bevel=0.0, smooth=False):
    if mat:
        assign(obj, mat)
    if bevel:
        modifier = obj.modifiers.new("EdgeSoftness", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    if smooth and hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if hasattr(obj.data, "polygons") and len(obj.data.polygons) > 0:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project()
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)
    return obj


def organic_displace(obj, strength=0.03, noise_scale=0.8):
    """Add small procedural surface breakup before exporting the GLB."""
    texture = bpy.data.textures.new(f"{obj.name} Surface Noise", type="CLOUDS")
    texture.noise_scale = noise_scale
    texture.noise_depth = 2
    modifier = obj.modifiers.new("OrganicSurface", "DISPLACE")
    modifier.texture = texture
    modifier.strength = strength
    modifier.texture_coords = "GLOBAL"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def ico(name, location, scale, mat, parent_obj=None, subdivisions=2, smooth=True, surface_noise=0.0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if surface_noise:
        organic_displace(obj, surface_noise, max(0.45, min(scale) * 1.7))
    finish(obj, mat, smooth=smooth)
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def uv_sphere(name, location, scale, mat, parent_obj=None, segments=36, ring_count=24, surface_noise=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=ring_count,
        radius=1.0,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if surface_noise:
        organic_displace(obj, surface_noise, max(0.45, min(scale) * 1.7))
    finish(obj, mat, smooth=True)
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


def cylinder(name, location, radius, depth, mat, parent_obj=None, rotation=None, vertices=12, smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    finish(obj, mat, smooth=smooth)
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def cone(name, location, radius, depth, mat, parent_obj=None, rotation=None, vertices=8, smooth=False):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0.04, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    finish(obj, mat, smooth=smooth)
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


def mesh_object(name, vertices, faces, mat, parent_obj=None, smooth=False):
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, mat, smooth=smooth)
    if parent_obj:
        parent(obj, parent_obj)
    return obj


def add_animation_cycle(obj, action_name, rotations=None, scales=None):
    """Attach a small reusable looping animation to one exported GLB node."""
    if not obj:
        return
    action = bpy.data.actions.new(action_name)
    obj.animation_data_create()
    obj.animation_data.action = action
    rotations = rotations or []
    scales = scales or []
    for frame, rotation in rotations:
        obj.rotation_euler = rotation
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
    for frame, scale in scales:
        obj.scale = scale
        obj.keyframe_insert(data_path="scale", frame=frame)
def extruded_outline(name, outline, thickness, mat, parent_obj=None, z_center=0.0):
    vertices = [(x, y, z_center - thickness / 2.0) for x, y in outline]
    vertices += [(x, y, z_center + thickness / 2.0) for x, y in outline]
    count = len(outline)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    return mesh_object(name, vertices, faces, mat, parent_obj)


def export(filepath):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format="GLB",
        export_apply=True,
        export_animations=True,
        export_materials="EXPORT",
    )


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.frame_start = 1
    scene.frame_end = 48
    scene.world = bpy.data.worlds.new("AssetWorld")
    scene.world.color = (0.015, 0.02, 0.02)


def create_hunter():
    reset()
    chitin = material("Hunter Chitin", (0.055, 0.12, 0.105), roughness=0.38, metallic=0.16)
    leather = material("Hunter Leather", (0.11, 0.045, 0.022), roughness=0.86)
    bone = material("Hunter Bone", (0.72, 0.49, 0.22), roughness=0.5)
    mineral = material("Hunter Mineral", (0.24, 0.29, 0.28), roughness=0.26, metallic=0.72)
    cloth = material("Hunter Cloth", (0.18, 0.22, 0.19), roughness=0.93)
    ember = material("Hunter Ember", (0.78, 0.12, 0.018), roughness=0.3, emission=(0.95, 0.035, 0.003))

    root = empty("HunterRoot", (0.0, 0.0, 0.0))
    uv_sphere("chest", (0.0, 1.38, 0.0), (0.66, 0.86, 0.43), leather, root, surface_noise=0.018)
    uv_sphere("chest_shell", (0.0, 1.53, 0.29), (0.68, 0.58, 0.28), chitin, root, surface_noise=0.026)
    cube("chest_plate", (0.0, 1.54, 0.58), (0.82, 0.62, 0.14), bone, root, bevel=0.08, rotation=(math.radians(-12), 0.0, 0.0))
    uv_sphere("back_shell", (0.0, 1.42, -0.38), (0.7, 0.82, 0.24), cloth, root)
    for index, height in enumerate((1.92, 2.12, 2.28)):
        cone(f"back_spine_{index}", (0.0, height, -0.38), 0.16 - index * 0.025, 0.5 - index * 0.08, bone, root, vertices=6)
    uv_sphere("belt", (0.0, 0.88, 0.0), (0.72, 0.2, 0.48), leather, root)

    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        x = side * 0.48
        ico(f"leg_{side_name}", (x, 0.48, 0.0), (0.24, 0.58, 0.27), leather, root)
        cube(f"greave_{side_name}", (x, 0.55, 0.25), (0.34, 0.66, 0.22), chitin, root, bevel=0.06, rotation=(math.radians(side * 5), 0.0, 0.0))
        cube(f"knee_{side_name}", (x, 0.88, 0.28), (0.38, 0.25, 0.25), bone, root, bevel=0.05)
        ico(f"boot_{side_name}", (x, 0.14, 0.18), (0.32, 0.16, 0.5), leather, root)
        ico(f"shoulder_{side_name}", (side * 0.64, 1.98, 0.0), (0.38, 0.3, 0.44), bone, root)
        cylinder(f"arm_upper_{side_name}", (side * 0.72, 1.56, 0.08), 0.16, 0.64, leather, root, rotation=(0.0, 0.0, math.radians(side * 13)))
        cylinder(f"arm_lower_{side_name}", (side * 0.77, 1.18, 0.22), 0.13, 0.58, chitin, root, rotation=(math.radians(side * 18), 0.0, math.radians(side * 8)))
        cone(f"shoulder_spike_{side_name}", (side * 0.72, 2.26, 0.02), 0.18, 0.68, bone, root, rotation=(0.0, math.radians(side * -22), 0.0), vertices=6)
        ico(f"gauntlet_{side_name}", (side * 0.78, 1.03, 0.35), (0.2, 0.2, 0.23), bone, root)

    cylinder("neck_guard", (0.0, 2.08, 0.0), 0.26, 0.38, chitin, root, vertices=8)
    cube("belt_clasp", (0.0, 0.9, 0.49), (0.22, 0.24, 0.08), mineral, root, bevel=0.025)
    cube("rear_skirt", (0.0, 0.56, -0.34), (0.68, 0.52, 0.1), cloth, root, bevel=0.03, rotation=(math.radians(10), 0.0, 0.0))
    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        cube(f"hip_pouch_{side_name}", (side * 0.64, 0.78, 0.2), (0.24, 0.28, 0.25), leather, root, bevel=0.04)
        cube(f"waist_tasset_{side_name}", (side * 0.54, 0.58, 0.02), (0.14, 0.46, 0.42), chitin, root, bevel=0.04, rotation=(0.0, 0.0, math.radians(side * -14)))

    head = uv_sphere("head", (0.0, 2.48, 0.02), (0.43, 0.48, 0.39), leather, root, surface_noise=0.014)
    uv_sphere("helmet_shell", (0.0, 2.64, -0.03), (0.48, 0.38, 0.42), chitin, root, surface_noise=0.024)
    cube("helmet_front", (0.0, 2.48, 0.39), (0.58, 0.36, 0.2), bone, root, bevel=0.06, rotation=(math.radians(-9), 0.0, 0.0))
    cube("helmet_back", (0.0, 2.43, -0.3), (0.46, 0.48, 0.18), cloth, root, bevel=0.04)
    for side in (-1, 1):
        cone(f"helmet_horn_{side}", (side * 0.27, 2.86, 0.04), 0.11, 0.64, bone, root, rotation=(math.radians(-18), math.radians(side * 22), 0.0), vertices=6)
    cube("visor", (0.0, 2.51, 0.51), (0.34, 0.08, 0.08), mineral, root, bevel=0.025)
    ico("visor_glow", (0.0, 2.51, 0.55), (0.1, 0.035, 0.025), ember, root)
    add_animation_cycle(
        head,
        "HunterIdle",
        rotations=[
            (1, (0.0, 0.0, 0.0)),
            (24, (math.radians(-2.2), 0.0, 0.0)),
            (48, (0.0, 0.0, 0.0)),
        ],
    )

    weapon = empty("weaponPivot", (0.72, 1.28, 0.05), root)
    cylinder("weapon_grip", (0.0, 0.32, 0.0), 0.1, 0.68, leather, weapon, rotation=(math.pi / 2, 0.0, 0.0))
    ico("weapon_pommel", (0.0, -0.05, 0.0), (0.14, 0.14, 0.14), bone, weapon)
    cube("weapon_guard", (0.0, 0.75, 0.0), (0.98, 0.14, 0.24), bone, weapon, bevel=0.05)
    for side in (-1, 1):
        cone(f"weapon_guard_horn_{side}", (side * 0.54, 0.82, 0.0), 0.09, 0.36, bone, weapon, rotation=(0.0, 0.0, math.radians(side * -58)), vertices=6)
    blade_outline = [(-0.2, 0.82), (0.2, 0.82), (0.28, 2.98), (0.16, 3.34), (0.0, 3.58), (-0.16, 3.34), (-0.28, 2.98)]
    extruded_outline("weapon_blade", blade_outline, 0.16, mineral, weapon)
    core_outline = [(-0.1, 1.0), (0.1, 1.0), (0.14, 2.95), (0.0, 3.34), (-0.14, 2.95)]
    extruded_outline("weapon_blade_core", core_outline, 0.07, bone, weapon, z_center=0.11)
    cone("weapon_tip", (0.0, 3.52, 0.0), 0.27, 0.68, bone, weapon, vertices=6)
    for index, x in enumerate((-0.23, 0.23)):
        cone(f"weapon_saw_{index}", (x, 2.38, 0.0), 0.08, 0.38, bone, weapon, rotation=(0.0, math.radians(x * 100), math.radians(x * 120)), vertices=6)
    for ridge_index, ridge_y in enumerate((1.35, 1.85, 2.35, 2.85)):
        cube(f"weapon_ridge_{ridge_index}", (0.0, ridge_y, 0.12), (0.22 - ridge_index * 0.02, 0.07, 0.06), chitin, weapon, bevel=0.015)
    ico("weapon_gem", (0.0, 0.86, 0.13), (0.08, 0.08, 0.04), ember, weapon)

    # 雙劍樞紐置於身體中軸，左右手刀組分別對齊獵人左右護手位置
    dual_weapon = empty("dualWeaponPivot", (0.0, 1.28, 0.08), root)
    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        hand = empty(f"dual_hand_{side_name}", (side * 0.76, -0.06, 0.18), dual_weapon)
        hand.rotation_euler = (math.radians(10), 0.0, math.radians(side * -8))
        cylinder(f"dual_grip_{side_name}", (0.0, 0.0, 0.0), 0.075, 0.52, leather, hand, rotation=(math.pi / 2, 0.0, 0.0), vertices=12)
        ico(f"dual_pommel_{side_name}", (0.0, -0.24, 0.0), (0.095, 0.095, 0.095), bone, hand)
        cube(f"dual_guard_{side_name}", (0.0, 0.3, 0.0), (0.44, 0.09, 0.16), bone, hand, bevel=0.025)
        dual_outline = [(-0.085, 0.34), (0.085, 0.34), (0.17, 1.68), (0.09, 1.96), (0.0, 2.12), (-0.11, 1.82)]
        extruded_outline(f"dual_blade_{side_name}", dual_outline, 0.08, mineral, hand)
        dual_core_outline = [(-0.045, 0.44), (0.045, 0.44), (0.08, 1.62), (0.0, 1.88), (-0.055, 1.62)]
        extruded_outline(f"dual_blade_core_{side_name}", dual_core_outline, 0.045, bone, hand, z_center=0.055)
        cone(f"dual_tip_{side_name}", (0.0, 2.08, 0.0), 0.14, 0.34, bone, hand, vertices=6)
        cone(f"dual_fang_{side_name}", (side * 0.14, 1.25, 0.0), 0.06, 0.26, bone, hand, rotation=(0.0, 0.0, math.radians(side * -48)), vertices=6)
        ico(f"dual_gem_{side_name}", (0.0, 0.32, 0.09), (0.055, 0.055, 0.03), ember, hand)

    export(OUTPUT / "hunter.glb")


def create_monster():
    reset()
    hide = material("Hide", (0.12, 0.028, 0.018), roughness=0.76)
    hide_light = material("Hide Highlight", (0.28, 0.075, 0.025), roughness=0.64)
    chitin = material("Chitin", (0.24, 0.095, 0.028), roughness=0.39, metallic=0.1)
    bone = material("Bone", (0.65, 0.38, 0.13), roughness=0.54)
    wing = material("Wing Membrane", (0.075, 0.018, 0.012), roughness=0.9)
    eye = material("Eye", (0.78, 0.12, 0.015), roughness=0.2, emission=(0.95, 0.05, 0.005))
    scar = material("Scar", (0.39, 0.1, 0.025), roughness=0.68)

    root = empty("MonsterRoot", (0.0, 0.0, 0.0))
    uv_sphere("body", (0.0, 2.35, -0.25), (2.15, 1.45, 3.2), hide, root, segments=32, ring_count=20, surface_noise=0.06)
    uv_sphere("rib_cage", (0.0, 2.48, 1.25), (1.78, 1.22, 1.5), hide_light, root, segments=28, ring_count=18, surface_noise=0.045)
    uv_sphere("shoulder_shell", (0.0, 3.15, 1.15), (1.9, 0.62, 1.36), chitin, root, surface_noise=0.04)
    uv_sphere("neck_mass", (0.0, 3.2, 2.65), (1.18, 0.86, 0.95), hide, root, segments=24, ring_count=16, surface_noise=0.032)
    cube("belly_plate", (0.0, 2.18, 1.86), (2.05, 0.78, 0.2), bone, root, bevel=0.1, rotation=(math.radians(-10), 0.0, 0.0))
    for index, height in enumerate((1.76, 2.02, 2.28)):
        cube(f"belly_ridge_{index}", (0.0, height, 2.05), (1.3 - index * 0.18, 0.12, 0.12), chitin, root, bevel=0.04)
    for index, z in enumerate((1.0, 0.25, -0.5, -1.25)):
        cone(f"dorsal_spine_{index}", (0.0, 3.55 - index * 0.16, z), 0.3 - index * 0.035, 1.05 - index * 0.11, bone, root, vertices=6)
    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        ico(f"shoulder_plate_{side_name}", (side * 1.55, 3.1, 1.0), (0.8, 0.55, 1.05), chitin, root)
        ico(f"shoulder_bone_{side_name}", (side * 1.78, 3.2, 1.28), (0.28, 0.32, 0.7), bone, root)
        cylinder(f"front_upper_leg_{side_name}", (side * 1.45, 1.65, 1.55), 0.42, 1.72, hide, root, rotation=(math.radians(side * 14), 0.0, math.radians(side * 12)))
        ico(f"front_elbow_{side_name}", (side * 1.52, 0.92, 1.85), (0.48, 0.42, 0.5), chitin, root)
        cylinder(f"front_lower_leg_{side_name}", (side * 1.48, 0.54, 2.08), 0.3, 0.9, hide_light, root, rotation=(math.radians(side * 12), 0.0, math.radians(side * 10)))
        cone(f"front_claw_{side_name}", (side * 1.48, 0.12, 2.48), 0.3, 1.15, bone, root, rotation=(math.radians(-22), math.radians(side * 8), 0.0), vertices=6)
        cylinder(f"hind_upper_leg_{side_name}", (side * 1.42, 1.5, -1.65), 0.52, 2.1, hide, root, rotation=(math.radians(side * 23), 0.0, math.radians(side * -14)))
        ico(f"hind_knee_{side_name}", (side * 1.58, 0.66, -2.06), (0.58, 0.52, 0.6), chitin, root)
        cylinder(f"hind_lower_leg_{side_name}", (side * 1.62, 0.45, -2.36), 0.34, 1.15, hide_light, root, rotation=(math.radians(side * -16), 0.0, math.radians(side * -10)))
        cone(f"hind_claw_{side_name}", (side * 1.68, 0.12, -2.65), 0.38, 1.36, bone, root, rotation=(math.radians(-28), math.radians(side * 8), 0.0), vertices=6)

    head = empty("head", (0.0, 3.2, 4.45), root)
    uv_sphere("head_plates", (0.0, 0.0, 0.0), (1.48, 1.12, 1.58), chitin, head, segments=28, ring_count=18, surface_noise=0.05)
    uv_sphere("muzzle", (0.0, -0.08, 1.12), (1.12, 0.68, 0.92), hide_light, head, segments=24, ring_count=16, surface_noise=0.028)
    uv_sphere("jaw", (0.0, -0.68, 0.85), (1.08, 0.42, 1.0), hide, head, surface_noise=0.024)
    cube("jaw_plate", (0.0, -0.62, 1.24), (1.3, 0.16, 0.5), bone, head, bevel=0.05, rotation=(math.radians(8), 0.0, 0.0))
    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        cone(f"horn_{side_name}", (side * 0.9, 0.75, 0.12), 0.38, 2.55, bone, head, rotation=(math.radians(-32), math.radians(side * -24), 0.0), vertices=6)
        ico(f"eye_{side_name}", (side * 0.72, 0.08, 1.34), (0.19, 0.13, 0.08), eye, head)
        ico(f"nostril_{side_name}", (side * 0.32, -0.12, 1.8), (0.11, 0.06, 0.05), scar, head)
        for tooth in range(4):
            cone(f"tooth_{side_name}_{tooth}", (side * (0.36 + tooth * 0.22), -0.86, 0.9 + tooth * 0.15), 0.09, 0.45, bone, head, rotation=(math.pi, 0.0, 0.0), vertices=6)

    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        wing_root = empty(f"wing_{side_name}", (side * 1.95, 3.15, 0.55), root)
        vertices = [(0.0, 0.0, 0.0), (side * 1.35, 0.3, 0.55), (side * 2.55, 0.02, 0.05), (side * 2.25, -0.4, -1.25), (side * 1.15, -0.25, -1.65)]
        faces = [(0, 1, 4), (1, 2, 3), (1, 3, 4)]
        mesh_object(f"wing_membrane_{side_name}", vertices, faces, wing, wing_root)
        cone(f"wing_bone_outer_{side_name}", (side * 1.28, 0.03, -0.1), 0.13, 3.2, bone, wing_root, rotation=(0.0, math.radians(side * 69), 0.0), vertices=6)
        cone(f"wing_bone_lower_{side_name}", (side * 1.1, -0.38, -0.72), 0.1, 2.2, bone, wing_root, rotation=(math.radians(side * 18), math.radians(side * 55), 0.0), vertices=6)
        cone(f"wing_claw_{side_name}", (side * 1.42, 0.28, 0.64), 0.14, 0.72, bone, wing_root, rotation=(math.radians(-45), math.radians(side * 28), 0.0), vertices=6)

    tail = empty("tail", (0.0, 2.18, -3.25), root)
    for index in range(5):
        scale = 0.76 - index * 0.12
        ico(f"tail_segment_{index}", (0.0, 0.05 - index * 0.05, -index * 1.15), (scale, scale * 0.92, 1.28 - index * 0.07), hide if index % 2 == 0 else chitin, tail, surface_noise=0.03)
        if index in (1, 2, 3):
            for side in (-1, 1):
                side_name = "l" if side < 0 else "r"
                cone(f"tail_fin_{index}_{side_name}", (side * (scale + 0.14), 0.02 - index * 0.05, -index * 1.15), 0.12, 0.58 - index * 0.06, bone, tail, rotation=(0.0, math.radians(side * 68), math.radians(side * -18)), vertices=6)
    cone("tail_spike", (0.0, -0.2, -5.95), 0.36, 1.7, bone, tail, rotation=(math.pi, 0.0, 0.0), vertices=6)
    add_animation_cycle(
        bpy.data.objects.get("dorsal_spine_0"),
        "MonsterIdleSpine",
        scales=[
            (1, (1.0, 1.0, 1.0)),
            (24, (1.04, 0.98, 1.04)),
            (48, (1.0, 1.0, 1.0)),
        ],
    )

    export(OUTPUT / "monster.glb")


def create_environment():
    reset()
    ground = material("Forest Ground", (0.16, 0.23, 0.14), roughness=0.98)
    arena_soil = material("Arena Soil", (0.19, 0.25, 0.15), roughness=0.96)
    stone = material("Forest Stone", (0.17, 0.19, 0.18), roughness=0.92)
    stone_light = material("Forest Stone Lichen", (0.27, 0.34, 0.25), roughness=0.98)
    bark = material("Forest Bark", (0.16, 0.07, 0.03), roughness=0.94)
    moss = material("Forest Moss", (0.16, 0.28, 0.09), roughness=1.0)
    leaf = material("Forest Leaf", (0.08, 0.22, 0.08), roughness=0.98)
    ancient_bone = material("Ancient Relic Bone", (0.58, 0.46, 0.28), roughness=0.62)
    ember = material("Forest Ember Fungus", (0.38, 0.08, 0.025), roughness=0.42, emission=(0.28, 0.025, 0.004))

    root = empty("HuntingGroundRoot", (0.0, 0.0, 0.0))

    # 完整連續獵場地形網格：中央保留平坦高度 (y≈0.025) 供戰鬥走位與預警圈貼合，
    # 外圍平滑隆起成自然山谷，消除中央破洞與平板斷層。
    grid_size = 53
    extent = 56.0
    vertices = []
    for row in range(grid_size):
        z = -extent + (row / (grid_size - 1)) * extent * 2.0
        for column in range(grid_size):
            x = -extent + (column / (grid_size - 1)) * extent * 2.0
            distance = math.sqrt(x * x + z * z)
            outer = clamp((distance - 14.0) / 36.0)
            ridge = math.sin(x * 0.18 + z * 0.07) * 0.32 + math.cos(z * 0.21 - x * 0.05) * 0.22
            inner_micro = math.sin(x * 0.35 - z * 0.28) * 0.008 * (1.0 - outer)
            height = 0.022 + inner_micro + (outer ** 1.35) * (0.36 + ridge)
            vertices.append((x, max(0.015, min(1.35, height)), z))
    faces = []
    for row in range(grid_size - 1):
        for column in range(grid_size - 1):
            top_left = row * grid_size + column
            top_right = top_left + 1
            bottom_left = (row + 1) * grid_size + column
            bottom_right = bottom_left + 1
            faces.append((top_left, bottom_left, bottom_right, top_right))
    mesh_object("terrain_ring", vertices, faces, ground, root, smooth=True)

    # 中央獵場踏み跡土層與貼地碎石
    cylinder("arena_soil_disc", (0.0, 0.018, 0.0), 15.5, 0.024, arena_soil, root, vertices=48, smooth=True)
    for pebble_index in range(14):
        p_angle = (pebble_index / 14.0) * math.tau + 0.4
        p_dist = 11.5 + (pebble_index % 3) * 1.9
        px = math.cos(p_angle) * p_dist
        pz = math.sin(p_angle) * p_dist
        ico(f"arena_pebble_{pebble_index}", (px, 0.07, pz), (0.32 + (pebble_index % 3) * 0.09, 0.11, 0.26), stone_light if pebble_index % 2 else stone, root, subdivisions=1, smooth=True)

    # 遠古巨獸骨骸遺跡（取代原本 Three.js 的簡易幾何骨骸）
    relic = empty("ancient_bone_site", (-17.0, 0.0, -13.0), root)
    for rib_idx in range(6):
        side = -1 if rib_idx % 2 == 0 else 1
        pair = rib_idx // 2
        rib_z = (pair - 1.0) * 1.65
        rib = cylinder(
            f"ancient_rib_{rib_idx}",
            (side * 1.35, 1.35 + pair * 0.12, rib_z),
            0.22 - pair * 0.02,
            4.2 - pair * 0.25,
            ancient_bone,
            relic,
            rotation=(math.radians(12), math.radians(side * 16), math.radians(side * -38)),
            vertices=10,
            smooth=True,
        )
        organic_displace(rib, 0.025, 0.9)
        cone(
            f"ancient_rib_tip_{rib_idx}",
            (side * 0.32, 2.95 + pair * 0.08, rib_z - 0.15),
            0.16,
            0.85,
            ancient_bone,
            relic,
            rotation=(math.radians(-14), 0.0, math.radians(side * -62)),
            vertices=6,
            smooth=True,
        )
    for vert_idx in range(4):
        ico(
            f"ancient_vertebra_{vert_idx}",
            (0.0, 0.36, -2.2 + vert_idx * 1.45),
            (0.56, 0.42, 0.62),
            ancient_bone,
            relic,
            subdivisions=2,
            smooth=True,
            surface_noise=0.03,
        )
    skull = uv_sphere("ancient_skull", (0.0, 1.18, 2.75), (1.35, 0.92, 1.75), ancient_bone, relic, segments=24, ring_count=16, surface_noise=0.05)
    skull.rotation_euler = (math.radians(14), math.radians(-8), 0.0)
    for side in (-1, 1):
        side_name = "l" if side < 0 else "r"
        cone(
            f"ancient_skull_horn_{side_name}",
            (side * 1.05, 1.72, 2.35),
            0.34,
            2.4,
            ancient_bone,
            relic,
            rotation=(math.radians(-38), math.radians(side * -28), math.radians(side * 18)),
            vertices=8,
            smooth=True,
        )
        uv_sphere(f"ancient_skull_moss_{side_name}", (side * 0.55, 1.78, 2.65), (0.58, 0.12, 0.68), moss, relic, segments=14, ring_count=8)

    # 自然獵場外圍的圓潤巨石與苔蘚層，取代幾何感過強的圓柱石柱。
    for index in range(18):
        angle = (index / 18.0) * math.tau + 0.12 * math.sin(index * 1.7)
        distance = 31.0 + (index % 4) * 3.1
        x = math.cos(angle) * distance
        z = math.sin(angle) * distance
        height = 2.4 + (index % 5) * 0.62
        width = 1.9 + (index % 3) * 0.55
        rock = ico(f"boulder_{index}", (x, height * 0.48, z), (width, height, width * 0.82), stone, root, subdivisions=2, smooth=True)
        rock.rotation_euler = (0.08 * math.sin(index), angle * 0.35, 0.12 * math.cos(index * 0.7))
        uv_sphere(
            f"boulder_moss_{index}",
            (x - math.sin(angle) * 0.28, height * 0.9, z + math.cos(angle) * 0.22),
            (width * 0.58, 0.11 + height * 0.025, width * 0.42),
            stone_light if index % 3 else moss,
            root,
            segments=18,
            ring_count=10,
        )

    # 近景低矮掩體，讓第三人稱相機在戰鬥距離內也能看到環境尺度。
    for index in range(10):
        angle = (index / 10.0) * math.tau + 0.28
        distance = 8.5 + (index % 4) * 1.7
        x = math.cos(angle) * distance
        z = math.sin(angle) * distance
        height = 0.55 + (index % 3) * 0.2
        width = 0.72 + (index % 2) * 0.22
        rock = ico(f"near_stone_{index}", (x, height * 0.52, z), (width, height, width * 0.8), stone, root, subdivisions=2, smooth=True)
        rock.rotation_euler = (0.08 * math.cos(index), angle, 0.12 * math.sin(index))
        uv_sphere(
            f"near_stone_moss_{index}",
            (x - 0.08, height * 0.92, z + 0.06),
            (width * 0.58, 0.07, width * 0.4),
            moss,
            root,
            segments=14,
            ring_count=8,
        )

    # 倒木與裸露根系，讓低視角鏡頭有更自然的前景層次。
    for index, (x, y, z, length, rotation) in enumerate((
        (-14.0, 0.9, -8.0, 7.5, 0.3),
        (16.0, 0.72, 4.0, 6.2, -0.9),
        (-22.0, 0.62, 15.0, 5.4, 1.05),
    )):
        log = cylinder(
            f"fallen_log_{index}",
            (x, y, z),
            0.55 + index * 0.08,
            length,
            bark,
            root,
            rotation=(0.0, math.pi / 2, rotation),
            vertices=18,
            smooth=True,
        )
        log.rotation_euler.x += 0.12 * (index + 1)
        for vine_index in range(3):
            uv_sphere(
                f"log_moss_{index}_{vine_index}",
                (x - length * 0.28 + vine_index * length * 0.22, y + 0.48, z + 0.2 * math.sin(vine_index)),
                (0.58, 0.12, 0.36),
                moss,
                root,
                segments=16,
                ring_count=8,
            )

    # 遠景樹群：樹幹使用圓柱，樹冠由多個不規則球體組成，避免方塊輪廓。
    for index in range(9):
        angle = (index / 9.0) * math.tau + 0.22
        distance = 29.0 + (index % 3) * 2.8
        x = math.cos(angle) * distance
        z = math.sin(angle) * distance
        trunk_height = 5.8 + (index % 4) * 1.05
        cylinder(f"tree_trunk_{index}", (x, trunk_height * 0.5, z), 0.48 + (index % 2) * 0.16, trunk_height, bark, root, vertices=14, smooth=True)
        for canopy_index in range(4):
            offset_x = (canopy_index - 1.5) * 0.72
            offset_z = math.sin(canopy_index * 1.7) * 0.55
            uv_sphere(
                f"tree_canopy_{index}_{canopy_index}",
                (x + offset_x, trunk_height + 0.35 + (canopy_index % 2) * 0.5, z + offset_z),
                (1.7, 1.4 + (canopy_index % 2) * 0.35, 1.55),
                leaf if canopy_index % 3 else moss,
                root,
                segments=16,
                ring_count=10,
            )

    # 近中景草叢：用少量傾斜圓錐模擬成束草葉，增加地表的垂直層次。
    for index in range(28):
        angle = (index * 2.27) % math.tau
        distance = 13.0 + (index % 6) * 2.7
        x = math.cos(angle) * distance
        z = math.sin(angle) * distance
        for blade in range(3):
            offset = (blade - 1) * 0.14
            cone(
                f"grass_{index}_{blade}",
                (x + offset, 0.34 + (blade % 2) * 0.08, z - offset),
                0.11,
                0.68 + (blade % 2) * 0.18,
                leaf,
                root,
                rotation=(0.18 * math.sin(index + blade), angle + blade * 0.7, 0.12 * math.cos(index - blade)),
                vertices=5,
                smooth=True,
            )

    # 小型蕈類與岩屑，增加接近地面的尺度參照。
    for index in range(16):
        angle = (index * 2.41) % math.tau
        distance = 8.0 + (index % 6) * 3.7
        x = math.cos(angle) * distance
        z = math.sin(angle) * distance
        stem_height = 0.3 + (index % 3) * 0.1
        cylinder(f"fungus_stem_{index}", (x, stem_height * 0.5, z), 0.08, stem_height, stone_light, root, vertices=10, smooth=True)
        uv_sphere(f"fungus_cap_{index}", (x, stem_height + 0.07, z), (0.28, 0.1, 0.28), ember if index % 4 == 0 else moss, root, segments=14, ring_count=8)

    export(OUTPUT / "hunting_ground.glb")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    create_hunter()
    create_monster()
    create_environment()
    print(f"Generated assets in {OUTPUT}")


if __name__ == "__main__":
    main()
