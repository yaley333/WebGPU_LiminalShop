const canvas = document.querySelector("#scene");
const loading = document.querySelector("#loading");
const errorMessage = document.querySelector("#webgpuError");
const enterButton = document.querySelector("#enter");
const leaveButton = document.querySelector("#leave");
const intro = document.querySelector("#intro");
const hud = document.querySelector("#hud");
const clockLabel = document.querySelector("#clock");
const interactionHint = document.querySelector("#interactionHint");
const interactionLabel = document.querySelector("#interactionLabel");
const vertexData = [];
const reflectedVertexData = [];
let captureReflection = false;
let activeVertexData = vertexData;
let geometryTransform = null;
let geometryNormalTransform = null;

const shader = /* wgsl */ `
struct SceneUniforms {
  viewProjection: mat4x4<f32>,
  cameraAndTime: vec4<f32>,
  renderOptions: vec4<f32>,
};

@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(0) @binding(1) var merchandiseTexture: texture_2d<f32>;
@group(0) @binding(2) var merchandiseSampler: sampler;
@group(0) @binding(3) var floorReflectionTexture: texture_2d<f32>;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) normal: vec3<f32>,
  @location(3) emission: vec3<f32>,
  @location(4) texCoord: vec2<f32>,
  @location(5) textured: f32,
  @location(6) animation: f32,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) worldPosition: vec3<f32>,
  @location(2) normal: vec3<f32>,
  @location(3) emission: vec3<f32>,
  @location(4) texCoord: vec2<f32>,
  @location(5) textured: f32,
  @location(6) animation: f32,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  var worldPosition = input.position;
  worldPosition.y += sin(scene.cameraAndTime.w * 1.15 + input.position.z * 0.23 + input.position.x * 0.19) * 0.16 * max(input.animation, 0.0);
  var worldNormal = input.normal;
  if (scene.renderOptions.x > 0.5) {
    worldPosition.y = -worldPosition.y;
    worldNormal.y = -worldNormal.y;
  }
  output.clipPosition = scene.viewProjection * vec4<f32>(worldPosition, 1.0);
  output.color = input.color;
  output.worldPosition = worldPosition;
  output.normal = worldNormal;
  output.emission = input.emission;
  output.texCoord = input.texCoord;
  output.textured = input.textured;
  output.animation = input.animation;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let distanceToCamera = distance(input.worldPosition, scene.cameraAndTime.xyz);
  let fog = smoothstep(100.0, 235.0, distanceToCamera);
  let normal = normalize(input.normal);
  let lightDirection = normalize(vec3<f32>(-0.24, 0.92, 0.32));
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let viewDirection = normalize(scene.cameraAndTime.xyz - input.worldPosition);
  let halfDirection = normalize(lightDirection + viewDirection);
  let objectSpecular = pow(max(dot(normal, halfDirection), 0.0), 48.0) * abs(input.animation) * 0.62;
  let fixtureX = round(input.worldPosition.x / 6.0) * 6.0;
  let fixtureZ = 4.0 + round((input.worldPosition.z - 4.0) / 7.7) * 7.7;
  let lightDx = (input.worldPosition.x - fixtureX) / 0.72;
  let lightDz = (input.worldPosition.z - fixtureZ) / 2.15;
  let lightEdge = max(abs(lightDx), abs(lightDz));
  let lightPool = 1.0 - smoothstep(0.78, 1.18, lightEdge);
  let floorMask = select(0.0, 1.0, input.worldPosition.y < 0.08 && abs(normal.y) > 0.8);
  let overheadLight = lightPool * floorMask;
  let sheen = exp(-lightDx * lightDx * 2.8 - lightDz * lightDz * 1.6) * floorMask;
  let roomGlow = lightPool * exp(-abs(input.worldPosition.y - 5.2) * 0.42);
  let lighting = 0.62 + diffuse * 0.3 + overheadLight * 0.06 + roomGlow * 0.22;
  let packagePrint = textureSample(merchandiseTexture, merchandiseSampler, input.texCoord).rgb;
  let albedo = mix(input.color, input.color * packagePrint, input.textured);
  var wetReflection = vec3<f32>(0.0);
  if floorMask > 0.5 {
    let pixel = vec2<i32>(input.clipPosition.xy * 0.25);
    let pixelMax = vec2<i32>(scene.renderOptions.yz) - vec2<i32>(1, 1);
    let leftPixel = clamp(pixel + vec2<i32>(-1, 0), vec2<i32>(0, 0), pixelMax);
    let rightPixel = clamp(pixel + vec2<i32>(1, 0), vec2<i32>(0, 0), pixelMax);
    let upperPixel = clamp(pixel + vec2<i32>(0, -1), vec2<i32>(0, 0), pixelMax);
    let lowerPixel = clamp(pixel + vec2<i32>(0, 1), vec2<i32>(0, 0), pixelMax);
    let reflectionCenter = textureLoad(floorReflectionTexture, clamp(pixel, vec2<i32>(0, 0), pixelMax), 0);
    let reflectionLeft = textureLoad(floorReflectionTexture, leftPixel, 0);
    let reflectionRight = textureLoad(floorReflectionTexture, rightPixel, 0);
    let reflectionUpper = textureLoad(floorReflectionTexture, upperPixel, 0);
    let reflectionLower = textureLoad(floorReflectionTexture, lowerPixel, 0);
    let reflectionColor = reflectionCenter.rgb * 0.6
      + (reflectionLeft.rgb + reflectionRight.rgb + reflectionUpper.rgb + reflectionLower.rgb) * 0.1;
    let reflectionCoverage = reflectionCenter.a * 0.6
      + (reflectionLeft.a + reflectionRight.a + reflectionUpper.a + reflectionLower.a) * 0.1;
    wetReflection = reflectionColor * reflectionCoverage * 0.32;
  }
  let litColor = albedo * vec3<f32>(1.0, 0.97, 0.9) * lighting
    + vec3<f32>(0.12, 0.1, 0.075) * sheen
    + vec3<f32>(1.0, 0.83, 0.57) * overheadLight * 0.04
    + wetReflection
    + vec3<f32>(1.0, 0.93, 0.78) * objectSpecular;
  let fogColor = vec3<f32>(0.47, 0.43, 0.37);
  return vec4<f32>(mix(litColor, fogColor, fog * 0.72) + input.emission, 1.0);
}
`;

function tint(color, factor) {
  return color.map((component) => Math.min(1, component * factor));
}

function quad(points, color, options = {}) {
  const [a, b, c, d] = points.map((point) => geometryTransform ? geometryTransform(point) : point);
  const edgeA = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edgeB = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
    edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
    edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
  ];
  const length = Math.hypot(...normal) || 1;
  const n = normal.map((component) => component / length);
  const uv = options.uv || [[0, 1], [1, 1], [1, 0], [0, 0]];
  const normalAt = (index) => {
    const vertexNormal = options.normals?.[index];
    return vertexNormal && geometryNormalTransform ? geometryNormalTransform(vertexNormal) : vertexNormal;
  };
  const vertices = [
    [a, uv[0], normalAt(0)], [b, uv[1], normalAt(1)], [c, uv[2], normalAt(2)],
    [a, uv[0], normalAt(0)], [c, uv[2], normalAt(2)], [d, uv[3], normalAt(3)],
  ];
  const packedVertices = [];
  for (const [point, texCoord, vertexNormal] of vertices) {
    packedVertices.push(
      ...point, ...color, ...(vertexNormal || n), ...(options.emission || [0, 0, 0]),
      ...texCoord, options.textured ? 1 : 0, options.animation || 0,
    );
  }
  activeVertexData.push(...packedVertices);
  if (captureReflection) reflectedVertexData.push(...packedVertices);
}

function box(x, y, z, width, height, depth, color, emission = [0, 0, 0], animation = 0) {
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  const y0 = y - height / 2;
  const y1 = y + height / 2;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  const options = { emission, animation };
  quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], tint(color, 0.82), options);
  quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], tint(color, 0.57), options);
  quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], tint(color, 1.12), options);
  quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], tint(color, 0.92), options);
  quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], tint(color, 0.69), options);
  quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], tint(color, 0.93), options);
}

function steelTube(start, end, radius, color, animation = -0.85, segments = 8) {
  const direction = end.map((value, axis) => value - start[axis]);
  const length = Math.hypot(...direction) || 1;
  const axis = direction.map((value) => value / length);
  const reference = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const radialA = cross(axis, reference);
  const radialLength = Math.hypot(...radialA) || 1;
  const u = radialA.map((value) => value / radialLength);
  const v = cross(axis, u);
  const ringPoint = (center, angle) => center.map((value, i) =>
    value + radius * (u[i] * Math.cos(angle) + v[i] * Math.sin(angle)));
  const options = { animation };
  for (let segment = 0; segment < segments; segment += 1) {
    const angle0 = segment / segments * Math.PI * 2;
    const angle1 = (segment + 1) / segments * Math.PI * 2;
    quad([
      ringPoint(start, angle0),
      ringPoint(end, angle0),
      ringPoint(end, angle1),
      ringPoint(start, angle1),
    ], color, options);
  }
}

function shoppingCart(x, z, yaw) {
  const silver = [0.76, 0.81, 0.82];
  const brightSilver = [0.9, 0.94, 0.93];
  const darkSteel = [0.35, 0.4, 0.4];
  const rubber = [0.075, 0.085, 0.08];
  const transform = (localX, y, localZ) => [
    x + localX * Math.cos(yaw) + localZ * Math.sin(yaw),
    y,
    z - localX * Math.sin(yaw) + localZ * Math.cos(yaw),
  ];
  const wire = (start, end, radius = 0.014, color = silver) =>
    steelTube(transform(start[0], start[1], start[2]), transform(end[0], end[1], end[2]), radius, color);
  const rail = (start, end, radius = 0.028, color = brightSilver) =>
    steelTube(transform(start[0], start[1], start[2]), transform(end[0], end[1], end[2]), radius, color);

  const bottomY = 0.57;
  const rimY = 1.2;
  const bottomHalfWidth = 0.29;
  const rimHalfWidth = 0.43;
  const bottomHalfLength = 0.45;
  const rimHalfLength = 0.65;

  for (const localZ of [-bottomHalfLength, bottomHalfLength]) {
    rail([-bottomHalfWidth, bottomY, localZ], [bottomHalfWidth, bottomY, localZ]);
  }
  for (const localX of [-bottomHalfWidth, bottomHalfWidth]) {
    rail([localX, bottomY, -bottomHalfLength], [localX, bottomY, bottomHalfLength]);
  }
  for (const localZ of [-rimHalfLength, rimHalfLength]) {
    rail([-rimHalfWidth, rimY, localZ], [rimHalfWidth, rimY, localZ]);
  }
  for (const localX of [-rimHalfWidth, rimHalfWidth]) {
    rail([localX, rimY, -rimHalfLength], [localX, rimY, rimHalfLength]);
  }

  for (let row = 1; row <= 5; row += 1) {
    const amount = row / 6;
    const y = bottomY + (rimY - bottomY) * amount;
    const halfWidth = bottomHalfWidth + (rimHalfWidth - bottomHalfWidth) * amount;
    const halfLength = bottomHalfLength + (rimHalfLength - bottomHalfLength) * amount;
    for (const localX of [-halfWidth, halfWidth]) {
      wire([localX, y, -halfLength], [localX, y, halfLength], 0.012, row % 2 ? silver : brightSilver);
    }
    for (const localZ of [-halfLength, halfLength]) {
      wire([-halfWidth, y, localZ], [halfWidth, y, localZ], 0.012, row % 2 ? silver : brightSilver);
    }
  }

  for (let column = 0; column <= 8; column += 1) {
    const amount = column / 8;
    const bottomX = -bottomHalfWidth + amount * bottomHalfWidth * 2;
    const topX = -rimHalfWidth + amount * rimHalfWidth * 2;
    for (const side of [-1, 1]) {
      wire(
        [bottomX, bottomY, side * bottomHalfLength],
        [topX, rimY, side * rimHalfLength],
      );
    }
    const bottomZ = -bottomHalfLength + amount * bottomHalfLength * 2;
    const topZ = -rimHalfLength + amount * rimHalfLength * 2;
    for (const side of [-1, 1]) {
      wire(
        [side * bottomHalfWidth, bottomY, bottomZ],
        [side * rimHalfWidth, rimY, topZ],
      );
    }
  }

  for (let column = 0; column <= 8; column += 1) {
    const localX = -bottomHalfWidth + column * bottomHalfWidth * 2 / 8;
    wire([localX, bottomY, -bottomHalfLength], [localX, bottomY, bottomHalfLength], 0.012, brightSilver);
  }
  for (let row = 1; row <= 5; row += 1) {
    const localZ = -bottomHalfLength + row * bottomHalfLength * 2 / 6;
    wire([-bottomHalfWidth, bottomY, localZ], [bottomHalfWidth, bottomY, localZ], 0.012, brightSilver);
  }

  const chassisY = 0.32;
  for (const localZ of [-0.58, 0.58]) {
    rail([-0.37, chassisY, localZ], [0.37, chassisY, localZ], 0.032, darkSteel);
  }
  for (const localX of [-0.37, 0.37]) {
    rail([localX, chassisY, -0.58], [localX, chassisY, 0.58], 0.032, darkSteel);
  }
  for (const localX of [-0.34, 0.34]) {
    for (const localZ of [-0.53, 0.53]) {
      wire(
        [localX, chassisY, localZ],
        [Math.sign(localX) * bottomHalfWidth, bottomY, Math.sign(localZ) * bottomHalfLength],
        0.026,
        brightSilver,
      );
      wire([localX, 0.2, localZ], [localX, chassisY, localZ], 0.035, darkSteel);
      const wheelCenter = transform(localX, 0.105, localZ);
      const wheelStart = [wheelCenter[0] - 0.045 * Math.cos(yaw), wheelCenter[1], wheelCenter[2] + 0.045 * Math.sin(yaw)];
      const wheelEnd = [wheelCenter[0] + 0.045 * Math.cos(yaw), wheelCenter[1], wheelCenter[2] - 0.045 * Math.sin(yaw)];
      steelTube(wheelStart, wheelEnd, 0.105, rubber, -0.15, 16);
      steelTube(
        [wheelCenter[0] - 0.05 * Math.cos(yaw), wheelCenter[1], wheelCenter[2] + 0.05 * Math.sin(yaw)],
        [wheelCenter[0] + 0.05 * Math.cos(yaw), wheelCenter[1], wheelCenter[2] - 0.05 * Math.sin(yaw)],
        0.046,
        brightSilver,
        -0.85,
        12,
      );
    }
  }

  for (const localX of [-0.34, 0.34]) {
    wire([localX, 0.36, 0.53], [localX, 1.48, 0.92], 0.024, brightSilver);
    wire([localX, 1.48, 0.92], [localX, 1.55, 1.0], 0.024, brightSilver);
  }
  rail([-0.37, 1.55, 1.0], [0.37, 1.55, 1.0], 0.045, [0.12, 0.44, 0.23]);
  for (const localX of [-0.34, 0.34]) {
    wire([localX, 1.47, 0.88], [localX, 1.57, 0.95], 0.035, [0.14, 0.46, 0.25]);
  }
}

function productPanel(x, inward, y0, y1, z, width, cell) {
  const half = width / 2;
  const points = inward > 0
    ? [[x, y0, z + half], [x, y0, z - half], [x, y1, z - half], [x, y1, z + half]]
    : [[x, y0, z - half], [x, y0, z + half], [x, y1, z + half], [x, y1, z - half]];
  const column = cell % 4;
  const row = Math.floor(cell / 4);
  const inset = 0.006;
  const u0 = column / 4 + inset;
  const u1 = (column + 1) / 4 - inset;
  const v0 = row / 5 + inset;
  const v1 = (row + 1) / 5 - inset;
  quad(points, [1, 1, 1], {
    textured: true,
    uv: [[u0, v1], [u1, v1], [u1, v0], [u0, v0]],
  });
}

function snackBag(x, inward, y, z, width, height, color, cell) {
  const depth = 0.25;
  const packageColor = cell === 6 ? [0.018, 0.02, 0.025] : color;
  box(x, y + height * 0.5, z, depth, height * 0.98, width * 0.86, packageColor);
  productPanel(x + inward * (depth / 2 + 0.003), inward, y + 0.012, y + height * 0.97, z, width * 0.84, cell);
  productPanel(x - inward * (depth / 2 + 0.003), -inward, y + 0.012, y + height * 0.97, z, width * 0.84, cell);
}

const frontGlyphs = {
  "2": ["110", "001", "010", "100", "111"],
  "4": ["101", "101", "111", "001", "001"],
  A: ["010", "101", "111", "101", "101"],
  C: ["011", "100", "100", "100", "011"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  M: ["101", "111", "111", "101", "101"],
  O: ["010", "101", "101", "101", "010"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  L: ["100", "100", "100", "100", "111"],
  W: ["101", "101", "111", "111", "101"],
};

function frontText(x, inward, centerY, centerZ, text, pixelHeight, pixelWidth, color) {
  const gap = pixelWidth * 0.45;
  const textWidth = text.length * 3 * pixelWidth + (text.length - 1) * gap;
  const readsTowardPositiveZ = inward > 0;
  let cursorZ = centerZ + (readsTowardPositiveZ ? -textWidth / 2 : textWidth / 2);
  const frontX = x + inward * 0.006;
  for (const character of text) {
    const glyph = frontGlyphs[character];
    if (!glyph) {
      cursorZ += (readsTowardPositiveZ ? 1 : -1) * (pixelWidth * 2 + gap);
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        const z0 = readsTowardPositiveZ ? cursorZ + column * pixelWidth : cursorZ - (column + 1) * pixelWidth;
        const z1 = readsTowardPositiveZ ? cursorZ + (column + 1) * pixelWidth : cursorZ - column * pixelWidth;
        const y0 = centerY + (glyph.length / 2 - row - 1) * pixelHeight;
        const y1 = y0 + pixelHeight * 0.82;
        const points = inward > 0
          ? [[frontX, y0, z1], [frontX, y0, z0], [frontX, y1, z0], [frontX, y1, z1]]
          : [[frontX, y0, z0], [frontX, y0, z1], [frontX, y1, z1], [frontX, y1, z0]];
        quad(points, color);
      }
    }
    cursorZ += (readsTowardPositiveZ ? 1 : -1) * (3 * pixelWidth + gap);
  }
}

function boxPackage(x, inward, y, z, width, height, depth, color, accent, productName) {
  box(x, y + height / 2, z, depth, height, width, color);
  const panelX = x + inward * (depth / 2 + 0.01);
  const y0 = y + height * 0.025;
  const y1 = y + height * 0.975;
  const points = inward > 0
    ? [[panelX, y0, z + width * 0.47], [panelX, y0, z - width * 0.47], [panelX, y1, z - width * 0.47], [panelX, y1, z + width * 0.47]]
    : [[panelX, y0, z - width * 0.47], [panelX, y0, z + width * 0.47], [panelX, y1, z + width * 0.47], [panelX, y1, z - width * 0.47]];
  quad(points, tint(accent, 0.92));
  const badgeY = y + height * 0.7;
  const badgeZ = z;
  const badgeRadiusY = height * 0.11;
  const badgeRadiusZ = width * 0.18;
  const badgeColor = [0.94, 0.84, 0.58];
  const badgeCenter = [panelX + inward * 0.003, badgeY, badgeZ];
  const sides = 12;
  for (let segment = 0; segment < sides; segment += 1) {
    const a0 = segment / sides * Math.PI * 2;
    const a1 = (segment + 1) / sides * Math.PI * 2;
    const p0 = [panelX + inward * 0.003, badgeY + Math.sin(a0) * badgeRadiusY, badgeZ + Math.cos(a0) * badgeRadiusZ];
    const p1 = [panelX + inward * 0.003, badgeY + Math.sin(a1) * badgeRadiusY, badgeZ + Math.cos(a1) * badgeRadiusZ];
    quad(inward > 0 ? [badgeCenter, p1, p0, p0] : [badgeCenter, p0, p1, p1], badgeColor);
  }
  frontText(panelX, inward, badgeY, badgeZ, "24", height * 0.032, width * 0.06, [0.19, 0.16, 0.12]);
  frontText(panelX, inward, y + height * 0.39, z, productName, height * 0.045, width * 0.055, [0.98, 0.93, 0.81]);
  const stripeY = y + height * 0.2;
  const stripeWidth = width * 0.9;
  const stripePoints = inward > 0
    ? [[panelX + inward * 0.004, stripeY, z + stripeWidth / 2], [panelX + inward * 0.004, stripeY, z - stripeWidth / 2], [panelX + inward * 0.004, stripeY + height * 0.045, z - stripeWidth / 2], [panelX + inward * 0.004, stripeY + height * 0.045, z + stripeWidth / 2]]
    : [[panelX + inward * 0.004, stripeY, z - stripeWidth / 2], [panelX + inward * 0.004, stripeY, z + stripeWidth / 2], [panelX + inward * 0.004, stripeY + height * 0.045, z + stripeWidth / 2], [panelX + inward * 0.004, stripeY + height * 0.045, z - stripeWidth / 2]];
  quad(stripePoints, tint(color, 1.55));
  const bottomBandY = y + height * 0.1;
  const bandPoints = inward > 0
    ? [[panelX + inward * 0.004, bottomBandY, z + width * 0.28], [panelX + inward * 0.004, bottomBandY, z - width * 0.28], [panelX + inward * 0.004, bottomBandY + height * 0.035, z - width * 0.28], [panelX + inward * 0.004, bottomBandY + height * 0.035, z + width * 0.28]]
    : [[panelX + inward * 0.004, bottomBandY, z - width * 0.28], [panelX + inward * 0.004, bottomBandY, z + width * 0.28], [panelX + inward * 0.004, bottomBandY + height * 0.035, z + width * 0.28], [panelX + inward * 0.004, bottomBandY + height * 0.035, z - width * 0.28]];
  quad(bandPoints, [0.95, 0.85, 0.58]);
  const backX = x - inward * (depth / 2 + 0.01);
  const backPoints = inward > 0
    ? [[backX, y0, z - width * 0.47], [backX, y0, z + width * 0.47], [backX, y1, z + width * 0.47], [backX, y1, z - width * 0.47]]
    : [[backX, y0, z + width * 0.47], [backX, y0, z - width * 0.47], [backX, y1, z - width * 0.47], [backX, y1, z + width * 0.47]];
  quad(backPoints, tint(accent, 0.64));
  frontText(backX, -inward, y + height * 0.7, z, "24", height * 0.032, width * 0.06, [0.2, 0.17, 0.13]);
  frontText(backX, -inward, y + height * 0.39, z, productName, height * 0.045, width * 0.055, [0.98, 0.93, 0.81]);
}

function can(x, inward, y, z, color) {
  const radius = 0.14;
  const height = 0.64;
  const segments = 20;
  const centerY = y + height / 2;
  for (let segment = 0; segment < segments; segment += 1) {
    const a0 = segment / segments * Math.PI * 2;
    const a1 = (segment + 1) / segments * Math.PI * 2;
    const shade = 0.72 + Math.max(0, Math.cos((a0 + a1) * 0.5 - (inward > 0 ? 0 : Math.PI))) * 0.3;
    quad([
      [x + Math.cos(a0) * radius, centerY - height / 2, z + Math.sin(a0) * radius],
      [x + Math.cos(a1) * radius, centerY - height / 2, z + Math.sin(a1) * radius],
      [x + Math.cos(a1) * radius, centerY + height / 2, z + Math.sin(a1) * radius],
      [x + Math.cos(a0) * radius, centerY + height / 2, z + Math.sin(a0) * radius],
    ], tint(color, shade), {
      normals: [
        [Math.cos(a0), 0, Math.sin(a0)],
        [Math.cos(a1), 0, Math.sin(a1)],
        [Math.cos(a1), 0, Math.sin(a1)],
        [Math.cos(a0), 0, Math.sin(a0)],
      ],
    });
  }
  const lidBottom = y + height;
  const lidTop = lidBottom + 0.045;
  const lidRadius = radius * 0.82;
  for (let segment = 0; segment < segments; segment += 1) {
    const a0 = segment / segments * Math.PI * 2;
    const a1 = (segment + 1) / segments * Math.PI * 2;
    quad([
      [x + Math.cos(a0) * lidRadius, lidBottom, z + Math.sin(a0) * lidRadius],
      [x + Math.cos(a1) * lidRadius, lidBottom, z + Math.sin(a1) * lidRadius],
      [x + Math.cos(a1) * lidRadius, lidTop, z + Math.sin(a1) * lidRadius],
      [x + Math.cos(a0) * lidRadius, lidTop, z + Math.sin(a0) * lidRadius],
    ], [0.78, 0.72, 0.57]);
  }
  const lidCenter = [x, lidTop + 0.001, z];
  for (let segment = 0; segment < segments; segment += 1) {
    const a0 = segment / segments * Math.PI * 2;
    const a1 = (segment + 1) / segments * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * lidRadius, lidTop + 0.001, z + Math.sin(a0) * lidRadius];
    const p1 = [x + Math.cos(a1) * lidRadius, lidTop + 0.001, z + Math.sin(a1) * lidRadius];
    quad([lidCenter, p0, p1, p1], [0.88, 0.82, 0.66]);
  }
}

function makeMerchandiseAtlas() {
  const atlas = document.createElement("canvas");
  atlas.width = 512;
  atlas.height = 640;
  const context = atlas.getContext("2d");
  if (!context) throw new Error("Не удалось создать текстуры товаров.");
  const colors = [
    ["#c52c19", "#f7b632"], ["#e87817", "#ffe072"], ["#e4b326", "#a61d12"], ["#153b7c", "#e7b733"],
    ["#397541", "#f1d75d"], ["#ab2332", "#f4d293"], ["#08090c", "#e5aa37"], ["#bd651e", "#f6d48a"],
    ["#dc3e17", "#f4c451"], ["#1a4f86", "#e9c65e"], ["#dfbd52", "#b73922"], ["#386d38", "#f5de98"],
    ["#992937", "#e5bb6c"], ["#d77b1a", "#f2e3bc"], ["#226b57", "#efc653"], ["#313d80", "#e7b949"],
  ];
  const flavors = ["ПАПРИКА", "СМЕТАНА", "СОЛЬ", "СЫР", "ЛУК", "БАРБЕКЮ", "ПЕРЕЦ", "КЛАССИКА"];
  for (let index = 0; index < colors.length; index += 1) {
    const x = (index % 4) * 128;
    const y = Math.floor(index / 4) * 128;
    const [mainColor, accentColor] = colors[index];
    const gradient = context.createLinearGradient(x, y, x + 128, y + 128);
    gradient.addColorStop(0, accentColor);
    gradient.addColorStop(0.35, mainColor);
    gradient.addColorStop(1, mainColor);
    context.fillStyle = gradient;
    context.fillRect(x + 2, y + 2, 124, 124);
    context.fillStyle = "rgba(255,255,255,.13)";
    context.fillRect(x + 8, y + 8, 7, 112);
    context.fillRect(x + 113, y + 8, 5, 112);
    context.fillStyle = "#f4edcf";
    context.beginPath();
    context.ellipse(x + 64, y + 43, 47, 20, -0.08, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#31251b";
    context.font = "bold 20px Manrope, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(index % 2 ? "ХРУСТ" : "CRISP", x + 64, y + 43, 84);
    context.fillStyle = "rgba(255,255,255,.94)";
    context.font = "bold 10px Manrope, sans-serif";
    context.fillText("ЧИПСЫ", x + 64, y + 72);
    context.font = "bold 7px Manrope, sans-serif";
    context.fillText(flavors[index % flavors.length], x + 64, y + 86);
    for (let chip = 0; chip < 3; chip += 1) {
      const chipX = x + 48 + chip * 17;
      const chipY = y + 106 + (chip % 2) * 3;
      context.fillStyle = "#edc66c";
      context.beginPath();
      context.ellipse(chipX, chipY, 8, 5, (chip - 1) * 0.25, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(157,93,33,.6)";
      context.lineWidth = 1;
      context.stroke();
    }
    context.fillStyle = "rgba(255,255,255,.72)";
    context.fillRect(x + 3, y + 2, 122, 3);
    context.fillRect(x + 3, y + 123, 122, 3);
  }

  context.fillStyle = "#eee4cc";
  context.fillRect(2, 514, 124, 124);
  context.strokeStyle = "#8c241c";
  context.lineWidth = 5;
  context.strokeRect(5, 517, 118, 118);
  context.fillStyle = "#7a1d19";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 16px Manrope, sans-serif";
  context.fillText("WELCOME", 64, 531, 108);
  context.fillStyle = "#9c3025";
  context.beginPath();
  context.ellipse(64, 585, 33, 37, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f4e9d3";
  context.beginPath();
  context.ellipse(64, 584, 24, 29, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#26211e";
  context.beginPath();
  context.arc(55, 578, 3.5, 0, Math.PI * 2);
  context.arc(73, 578, 3.5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#a32320";
  context.beginPath();
  context.ellipse(64, 594, 7, 9, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#3a1718";
  context.beginPath();
  context.ellipse(64, 605, 10, 4, 0, 0, Math.PI * 2);
  context.fill();
  return atlas;
}

function wallGraphic(x, inward, centerY, centerZ, width, height) {
  const frontX = x + inward * 0.035;
  const y0 = centerY - height / 2;
  const y1 = centerY + height / 2;
  const z0 = centerZ - width / 2;
  const z1 = centerZ + width / 2;
  const u0 = 0.006;
  const u1 = 0.244;
  const v0 = 0.806;
  const v1 = 0.994;
  const points = inward > 0
    ? [[frontX, y0, z1], [frontX, y0, z0], [frontX, y1, z0], [frontX, y1, z1]]
    : [[frontX, y0, z0], [frontX, y0, z1], [frontX, y1, z1], [frontX, y1, z0]];
  quad(points, [1, 1, 1], {
    textured: true,
    uv: inward > 0
      ? [[u1, v1], [u0, v1], [u0, v0], [u1, v0]]
      : [[u1, v1], [u0, v1], [u0, v0], [u1, v0]],
  });
}

function ellipsoid(cx, cy, cz, radiusX, radiusY, radiusZ, color, animation = 0, balloonShape = false, segments = 40, rings = 28) {
  const point = (phi, theta) => {
    const bottomness = (1 - Math.cos(phi)) * 0.5;
    const taper = balloonShape ? 1 - 0.42 * bottomness * bottomness : 1;
    const radial = Math.sin(phi) * taper;
    return [
      cx + radiusX * radial * Math.cos(theta),
      cy + radiusY * Math.cos(phi),
      cz + radiusZ * radial * Math.sin(theta),
    ];
  };
  const normalAt = (phi, theta) => {
    const epsilon = 0.001;
    const thetaNext = point(phi, theta + epsilon);
    const thetaPrevious = point(phi, theta - epsilon);
    const phiNext = point(phi + epsilon, theta);
    const phiPrevious = point(phi - epsilon, theta);
    const tangentTheta = thetaNext.map((value, axis) => value - thetaPrevious[axis]);
    const tangentPhi = phiNext.map((value, axis) => value - phiPrevious[axis]);
    let normal = [
      tangentTheta[1] * tangentPhi[2] - tangentTheta[2] * tangentPhi[1],
      tangentTheta[2] * tangentPhi[0] - tangentTheta[0] * tangentPhi[2],
      tangentTheta[0] * tangentPhi[1] - tangentTheta[1] * tangentPhi[0],
    ];
    const radial = [point(phi, theta)[0] - cx, point(phi, theta)[1] - cy, point(phi, theta)[2] - cz];
    if (normal[0] * radial[0] + normal[1] * radial[1] + normal[2] * radial[2] < 0) {
      normal = normal.map((component) => -component);
    }
    const length = Math.hypot(...normal) || 1;
    return normal.map((component) => component / length);
  };
  for (let ring = 0; ring < rings; ring += 1) {
    const phi0 = ring / rings * Math.PI;
    const phi1 = (ring + 1) / rings * Math.PI;
    for (let segment = 0; segment < segments; segment += 1) {
      const theta0 = segment / segments * Math.PI * 2;
      const theta1 = (segment + 1) / segments * Math.PI * 2;
      const p00 = point(phi0, theta0);
      const p10 = point(phi1, theta0);
      const p11 = point(phi1, theta1);
      const p01 = point(phi0, theta1);
      quad([p00, p10, p11, p01], color, {
        animation,
        normals: [
          normalAt(phi0, theta0), normalAt(phi1, theta0),
          normalAt(phi1, theta1), normalAt(phi0, theta1),
        ],
      });
    }
  }
}

function toyClown(x, z, segments = 20, rings = 14) {
  const scale = 1.33;
  const sphere = (offsetX, y, offsetZ, radiusX, radiusY, radiusZ, color) =>
    ellipsoid(x + offsetX * scale, y * scale, z + offsetZ * scale,
      radiusX * scale, radiusY * scale, radiusZ * scale, color, 0, false, segments, rings);
  const skin = [0.91, 0.78, 0.62];
  const red = [0.76, 0.1, 0.08];
  const blue = [0.12, 0.31, 0.69];
  const gold = [0.96, 0.67, 0.12];

  sphere(0, 0.2, 0, 0.28, 0.19, 0.25, gold);
  sphere(0, 0.48, 0, 0.23, 0.31, 0.2, blue);
  sphere(0, 0.73, 0.015, 0.24, 0.1, 0.21, [0.96, 0.88, 0.72]);
  sphere(0, 0.95, 0.02, 0.2, 0.21, 0.18, skin);

  for (const side of [-1, 1]) {
    sphere(side * 0.205, 0.94, 0.015, 0.09, 0.105, 0.09, red);
    sphere(side * 0.074, 0.975, 0.18, 0.027, 0.035, 0.022, [0.08, 0.07, 0.065]);
    sphere(side * 0.073, 1.035, 0.172, 0.055, 0.018, 0.025, red);
    sphere(side * 0.25, 0.51, 0.015, 0.15, 0.13, 0.14, red);
    sphere(side * 0.36, 0.46, 0.025, 0.075, 0.085, 0.075, skin);
    sphere(side * 0.085, 0.48, 0.194, 0.035, 0.035, 0.025, gold);
  }
  sphere(0, 0.93, 0.215, 0.055, 0.055, 0.055, red);
  sphere(0, 0.84, 0.18, 0.095, 0.018, 0.02, [0.38, 0.08, 0.07]);
  sphere(0, 1.14, 0.01, 0.19, 0.055, 0.18, red);
  sphere(0, 1.25, 0.01, 0.07, 0.15, 0.07, gold);
  sphere(0, 1.39, 0.01, 0.052, 0.052, 0.052, [0.96, 0.92, 0.8]);
}

function makeScene() {
  vertexData.length = 0;
  reflectedVertexData.length = 0;
  const interactiveItems = [];
  const carts = [];
  const movingBalloons = [];
  const toy = { type: "clown", x: 0, z: 1.8, tilt: 0, angularVelocity: 0, radius: 0.72, label: "Неваляшка", active: false };
  const shelfColliders = [];
  const checkoutColliders = [
    { x: -15.5, z: 4.5, halfX: 1.8, halfZ: 0.72 },
    { x: 15.5, z: 4.5, halfX: 1.8, halfZ: 0.72 },
  ];
  captureReflection = false;
  quad([[-22, -0.055, 8], [22, -0.055, 8], [22, -0.055, -242], [-22, -0.055, -242]], [0.43, 0.39, 0.32]);
  const floorTileColors = [[0.66, 0.59, 0.48], [0.61, 0.55, 0.45], [0.69, 0.62, 0.51], [0.64, 0.57, 0.47]];
  const floorColumns = 30;
  const floorRows = 170;
  const floorTileWidth = 44 / floorColumns;
  const floorTileDepth = 250 / floorRows;
  for (let row = 0; row < floorRows; row += 1) {
    for (let column = 0; column < floorColumns; column += 1) {
      const x = -22 + column * floorTileWidth;
      const z = 8 - row * floorTileDepth;
      const color = floorTileColors[(row * 3 + column * 5) % floorTileColors.length];
      quad([
        [x + 0.012, -0.035, z - 0.012],
        [x + floorTileWidth - 0.012, -0.035, z - 0.012],
        [x + floorTileWidth - 0.012, -0.035, z - floorTileDepth + 0.012],
        [x + 0.012, -0.035, z - floorTileDepth + 0.012],
      ], color);
    }
  }
  const floorVertexCount = vertexData.length / 16;

  const ceilingColors = [[0.62, 0.58, 0.51], [0.57, 0.53, 0.47], [0.65, 0.61, 0.54], [0.6, 0.56, 0.49]];
  for (let row = 0; row < 125; row += 1) {
    for (let column = 0; column < 22; column += 1) {
      const x = -22 + column * 2;
      const z = 8 - row * 2;
      const color = ceilingColors[(row * 3 + column * 5) % ceilingColors.length];
      quad([[x + 0.025, 9.46, z - 0.025], [x + 0.025, 9.46, z - 1.975], [x + 1.975, 9.46, z - 1.975], [x + 1.975, 9.46, z - 0.025]], color);
    }
  }

  box(-22.2, 4.65, -117, 0.4, 9.6, 250, [0.88, 0.85, 0.79]);
  box(22.2, 4.65, -117, 0.4, 9.6, 250, [0.88, 0.85, 0.79]);
  for (const endZ of [8.25, -242.25]) {
    box(0, 4.65, endZ, 44.8, 9.6, 0.5, [0.88, 0.85, 0.79]);
  }

  for (const side of [-1, 1]) {
    const inward = -side;
    const wallX = side * 21.99;
    box(wallX, 2.2, -117, 0.12, 0.18, 250, [0.69, 0.1, 0.08]);
    box(wallX, 2.39, -117, 0.12, 0.035, 250, [0.96, 0.9, 0.81]);
    for (let mural = 0; mural < 6; mural += 1) {
      const muralZ = -25 - mural * 38;
      wallGraphic(wallX, inward, 5.95, muralZ, 3.6, 3.2);
    }
  }

  const rackCenters = [-18, -12, -6, 6, 12, 18];
  const chipColors = [
    [0.82, 0.11, 0.07], [0.91, 0.32, 0.06], [0.93, 0.69, 0.08], [0.08, 0.28, 0.59],
    [0.13, 0.43, 0.21], [0.72, 0.13, 0.29], [0.018, 0.02, 0.025], [0.72, 0.27, 0.08],
  ];
  const boxColors = [[0.68, 0.18, 0.09], [0.83, 0.58, 0.12], [0.13, 0.32, 0.48], [0.34, 0.49, 0.25], [0.72, 0.3, 0.18]];
  const drinkColors = [[0.57, 0.08, 0.07], [0.14, 0.17, 0.15], [0.77, 0.57, 0.12], [0.08, 0.28, 0.54]];
  const accents = [[0.99, 0.78, 0.18], [0.96, 0.83, 0.59], [0.76, 0.12, 0.07], [0.95, 0.8, 0.53], [0.92, 0.83, 0.63], [0.93, 0.75, 0.22], [0.67, 0.12, 0.08], [0.89, 0.73, 0.28]];
  const rackChunks = [];
  const environmentVertexCount = vertexData.length / 16;
  const environmentReflectionVertexCount = reflectedVertexData.length / 16;
  for (let sectionGroup = 0; sectionGroup < 23; sectionGroup += 3) {
    const vertexStart = vertexData.length / 16;
    const reflectionStart = reflectedVertexData.length / 16;
    const groupEnd = Math.min(sectionGroup + 3, 23);
    for (let section = sectionGroup; section < groupEnd; section += 1) {
      for (let rackIndex = 0; rackIndex < rackCenters.length; rackIndex += 1) {
      const x = rackCenters[rackIndex];
      const runLength = 9.35;
      const crossAisleWidth = 2.6;
      const z = -7 - section * runLength - Math.floor(section / 3) * crossAisleWidth;
      shelfColliders.push({ x, z, halfX: 0.55, halfZ: runLength / 2 });
      captureReflection = true;
      for (const shelfY of [0.045, 1.015, 1.985, 2.955, 3.925]) {
        box(x, shelfY, z, shelfY > 3.5 ? 1.04 : 1.02, 0.14, runLength, [0.67, 0.65, 0.57]);
      }
      for (let post = 0; post < 5; post += 1) {
        box(x, 2.09, z - runLength / 2 + 0.4 + post * (runLength - 0.8) / 4, 0.055, 4.25, 0.055, [0.49, 0.55, 0.44]);
      }
      captureReflection = false;
      for (let shelf = 0; shelf < 4; shelf += 1) {
        const shelfY = 0.115 + shelf * 0.97;
        const isDrinksShelf = shelf === 3 && rackIndex % 3 === 2;
        const isBoxShelf = shelf === 1 && rackIndex % 3 === 1;
        const productCount = isDrinksShelf ? 12 : 14;
        for (const facing of [-1, 1]) {
          for (let product = 0; product < productCount; product += 1) {
            const productZ = z - 4.15 + product * (isDrinksShelf ? 0.75 : 0.64);
            const productX = x + facing * 0.3;
            const variant = (product + section * 3 + rackIndex * 5 + shelf * 2) % 8;
            captureReflection = product % 4 === (section + shelf + rackIndex) % 4;
            const vertexStart = vertexData.length;
            const reflectionStart = reflectedVertexData.length;
            let itemHeight;
            if (isDrinksShelf) {
              can(productX, facing, shelfY, productZ, drinkColors[variant % drinkColors.length]);
              itemHeight = 0.64;
            } else if (isBoxShelf) {
              itemHeight = 0.52 + variant % 3 * 0.07;
              const productNames = ["CAFE", "TEA", "JUICE", "RICE", "OATS"];
              boxPackage(productX, facing, shelfY, productZ, 0.43 + variant % 2 * 0.05, itemHeight, 0.34, boxColors[variant % boxColors.length], accents[variant], productNames[variant % productNames.length]);
            } else {
              itemHeight = 0.71 + variant % 3 * 0.04;
              snackBag(productX, facing, shelfY, productZ, 0.62, itemHeight, chipColors[variant], variant);
            }
            interactiveItems.push({
              type: "product",
              x: productX,
              y: shelfY + itemHeight / 2,
              shelfY,
              z: productZ,
              radius: isDrinksShelf ? 0.28 : 0.43,
              label: isDrinksShelf ? "Напиток" : (isBoxShelf ? "Коробка" : "Чипсы"),
              sourceYaw: facing > 0 ? Math.PI / 2 : -Math.PI / 2,
              vertexStart,
              vertexEnd: vertexData.length,
              reflectionStart,
              reflectionEnd: reflectedVertexData.length,
              available: true,
              state: "shelf",
              kind: isDrinksShelf ? "can" : (isBoxShelf ? "box" : "chips"),
              height: itemHeight,
              cell: variant,
              color: isDrinksShelf ? drinkColors[variant % drinkColors.length] : (isBoxShelf ? boxColors[variant % boxColors.length] : chipColors[variant]),
              vx: 0,
              vy: 0,
              vz: 0,
              yaw: facing > 0 ? Math.PI / 2 : -Math.PI / 2,
            });
            captureReflection = false;
          }
          captureReflection = true;
          const railX = x + facing * 0.5;
          box(railX, shelfY + 0.15, z, 0.035, 0.035, runLength + 0.05, [0.72, 0.71, 0.64]);
          box(railX, shelfY + 0.28, z, 0.03, 0.025, runLength + 0.05, [0.72, 0.71, 0.64]);
          for (let tag = 0; tag < 5; tag += 1) {
            box(x + facing * 0.53, shelfY + 0.035, z - 3.8 + tag * 1.9, 0.025, 0.09, 0.55, [0.91, 0.85, 0.68]);
          }
          captureReflection = false;
        }
      }
      captureReflection = true;
      captureReflection = false;
      }
    }
    const firstZ = -7 - sectionGroup * 9.35 - Math.floor(sectionGroup / 3) * 2.6;
    const lastSection = groupEnd - 1;
    const lastZ = -7 - lastSection * 9.35 - Math.floor(lastSection / 3) * 2.6;
    rackChunks.push({
      centerZ: (firstZ + lastZ) / 2,
      vertexStart,
      vertexCount: vertexData.length / 16 - vertexStart,
      reflectionStart,
      reflectionCount: reflectedVertexData.length / 16 - reflectionStart,
    });
  }

  const tailVertexStart = vertexData.length / 16;
  const tailReflectionStart = reflectedVertexData.length / 16;
  const checkout = (x, z) => {
    box(x, 0.575, z, 3.35, 1.15, 1.25, [0.55, 0.47, 0.32]);
    box(x, 1.185, z, 3.52, 0.13, 1.38, [0.77, 0.72, 0.54]);
    box(x - 0.43, 1.405, z - 0.22, 0.42, 0.31, 0.34, [0.18, 0.25, 0.22]);
    box(x - 0.45, 1.585, z - 0.25, 0.35, 0.09, 0.25, [0.36, 0.72, 0.63]);
    box(x + 0.75, 1.275, z + 0.2, 0.58, 0.12, 0.8, [0.3, 0.34, 0.28]);
    box(x + 1.45, 1.275, z - 0.1, 0.24, 0.19, 0.3, [0.74, 0.3, 0.2]);
  };
  captureReflection = true;
  checkout(-15.5, 4.5);
  checkout(15.5, 4.5);
  const toyVertexStart = vertexData.length;
  const toyReflectionStart = reflectedVertexData.length;
  toyClown(toy.x, toy.z);
  toy.vertexStart = toyVertexStart;
  toy.vertexEnd = vertexData.length;
  toy.reflectionStart = toyReflectionStart;
  toy.reflectionEnd = reflectedVertexData.length;
  captureReflection = false;
  for (const [x, z, yaw] of [
    [-2.7, -8.5, 0.3],
    [-9, -52, -0.3],
    [14.8, -73, 0.55],
    [-1.8, -103, -0.72],
    [-15, -128, 0.2],
    [8.8, -160, 0.95],
    [-2.7, -185, -0.45],
    [15, -210, 0.38],
  ]) {
    const vertexStart = vertexData.length;
    const reflectionStart = reflectedVertexData.length;
    captureReflection = true;
    shoppingCart(x, z, yaw);
    captureReflection = false;
    carts.push({
      type: "cart",
      x,
      z,
      yaw,
      vx: 0,
      vz: 0,
      radius: 0.9,
      active: false,
      sourceX: x,
      sourceZ: z,
      sourceYaw: yaw,
      vertexStart,
      vertexEnd: vertexData.length,
      reflectionStart,
      reflectionEnd: reflectedVertexData.length,
      contents: [],
    });
  }

  for (let light = 0; light < 32; light += 1) {
    const z = 4 - light * 7.7;
    for (const x of [-18, -12, -6, 0, 6, 12, 18]) {
      captureReflection = true;
      box(x, 8.86, z, 1.48, 0.2, 4.35, [0.61, 0.57, 0.49]);
      box(x, 8.735, z, 1.08, 0.055, 3.82, [0.98, 0.93, 0.8], [0.72, 0.58, 0.4]);
      captureReflection = false;
    }
  }

  const balloonLocations = [
    [-3.5, -12, [0.87, 0.31, 0.25]], [-2.6, -12.8, [0.18, 0.34, 0.78]], [-1.7, -11.7, [0.91, 0.68, 0.12]],
    [3.2, -45, [0.79, 0.68, 0.39]], [-3.5, -79, [0.45, 0.68, 0.59]], [3.5, -108, [0.84, 0.39, 0.47]],
    [0, -117, [0.82, 0.69, 0.38]], [-18, -147, [0.54, 0.65, 0.79]], [18, -177, [0.82, 0.38, 0.29]],
  ];
  for (let i = 0; i < balloonLocations.length; i += 1) {
    const [x, z, color] = balloonLocations[i];
    const baseY = 2.65 + (i % 3) * 0.28;
    movingBalloons.push({
      type: "balloon",
      x,
      y: baseY,
      z,
      baseY,
      vx: 0,
      vy: 0,
      vz: 0,
      radius: 0.48,
      color,
      label: "Шарик",
      active: false,
    });
    const balloon = movingBalloons[movingBalloons.length - 1];
    balloon.vertexStart = vertexData.length;
    balloon.reflectionStart = reflectedVertexData.length;
    captureReflection = true;
    ellipsoid(x, baseY, z, 0.39, 0.51, 0.35, color, 1, true, 16, 10);
    steelTube([x, baseY - 0.48, z], [x, Math.max(0.06, baseY - 1.4), z], 0.008, [0.55, 0.45, 0.34], 0, 6);
    captureReflection = false;
    balloon.vertexEnd = vertexData.length;
    balloon.reflectionEnd = reflectedVertexData.length;
  }
  return {
    vertices: new Float32Array(vertexData),
    reflectionVertices: new Float32Array(reflectedVertexData),
    floorVertexCount,
    interactiveItems,
    carts,
    balloons: movingBalloons,
    toy,
    shelfColliders,
    checkoutColliders,
    rackChunks,
    environmentVertexCount,
    environmentReflectionVertexCount,
    tailVertexStart,
    tailReflectionStart,
  };
}

function buildDynamicGeometry(build) {
  const previousVertexData = activeVertexData;
  const previousReflection = captureReflection;
  const previousTransform = geometryTransform;
  const previousNormalTransform = geometryNormalTransform;
  const dynamicVertices = [];
  activeVertexData = dynamicVertices;
  captureReflection = false;
  geometryTransform = null;
  geometryNormalTransform = null;
  try {
    build();
    return new Float32Array(dynamicVertices);
  } finally {
    activeVertexData = previousVertexData;
    captureReflection = previousReflection;
    geometryTransform = previousTransform;
    geometryNormalTransform = previousNormalTransform;
  }
}

function hideGeometryRange(device, buffer, source, start, end) {
  if (end <= start) return;
  const hiddenVertices = source.subarray(start, end);
  for (let offset = 1; offset < hiddenVertices.length; offset += 16) hiddenVertices[offset] = -100;
  device.queue.writeBuffer(buffer, start * Float32Array.BYTES_PER_ELEMENT, hiddenVertices);
}

function transformMesh(source, sourcePosition, targetPosition, yaw, scale = 1, output = null, pitch = 0, pivotY = 0) {
  const transformed = output && output.length === source.length ? output : new Float32Array(source.length);
  transformed.set(source);
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const pitchCosine = Math.cos(pitch);
  const pitchSine = Math.sin(pitch);
  for (let offset = 0; offset < transformed.length; offset += 16) {
    const localX = (source[offset] - sourcePosition.x) * scale;
    const localY = (source[offset + 1] - sourcePosition.y) * scale;
    const localZ = (source[offset + 2] - sourcePosition.z) * scale;
    const yawX = localX * cosine + localZ * sine;
    const yawZ = -localX * sine + localZ * cosine;
    const pitchY = localY - pivotY;
    transformed[offset] = targetPosition.x + yawX * pitchCosine - pitchY * pitchSine;
    transformed[offset + 1] = targetPosition.y + pivotY + yawX * pitchSine + pitchY * pitchCosine;
    transformed[offset + 2] = targetPosition.z + yawZ;
    const normalX = source[offset + 6];
    const normalY = source[offset + 7];
    const normalZ = source[offset + 8];
    const yawNormalX = normalX * cosine + normalZ * sine;
    const yawNormalZ = -normalX * sine + normalZ * cosine;
    transformed[offset + 6] = yawNormalX * pitchCosine - normalY * pitchSine;
    transformed[offset + 7] = yawNormalX * pitchSine + normalY * pitchCosine;
    transformed[offset + 8] = yawNormalZ;
  }
  return transformed;
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * range, -1,
    0, 0, near * far * range, 0,
  ]);
}

function viewMatrix(eye, direction) {
  const forwardLength = Math.hypot(...direction) || 1;
  const z = direction.map((component) => -component / forwardLength);
  const rightLength = Math.hypot(z[2], 0, -z[0]) || 1;
  const x = [z[2] / rightLength, 0, -z[0] / rightLength];
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

function multiplyMatrices(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return result;
}

async function start() {
  if (!navigator.gpu) {
    loading.classList.add("hidden");
    errorMessage.hidden = false;
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Не найден WebGPU-адаптер.");
    const device = await adapter.requestDevice();
    device.addEventListener("uncapturederror", (event) => {
      console.error("WebGPU error:", event.error.message);
    });
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const sceneGeometry = makeScene();
    const vertices = sceneGeometry.vertices;
    const interactiveItems = sceneGeometry.interactiveItems;
    const carts = sceneGeometry.carts;
    const balloons = sceneGeometry.balloons;
    const toy = sceneGeometry.toy;
    const shelfColliders = sceneGeometry.shelfColliders;
    const checkoutColliders = sceneGeometry.checkoutColliders;
    const looseProducts = [];
    const productModelCache = new Map();
    const productColors = {
      chips: [[0.82, 0.11, 0.07], [0.91, 0.32, 0.06], [0.93, 0.69, 0.08], [0.08, 0.28, 0.59], [0.13, 0.43, 0.21], [0.72, 0.13, 0.29], [0.018, 0.02, 0.025], [0.72, 0.27, 0.08]],
      box: [[0.68, 0.18, 0.09], [0.83, 0.58, 0.12], [0.13, 0.32, 0.48], [0.34, 0.49, 0.25], [0.72, 0.3, 0.18]],
      can: [[0.57, 0.08, 0.07], [0.14, 0.17, 0.15], [0.77, 0.57, 0.12], [0.08, 0.28, 0.54]],
    };
    const productAccents = [[0.99, 0.78, 0.18], [0.96, 0.83, 0.59], [0.76, 0.12, 0.07], [0.95, 0.8, 0.53], [0.92, 0.83, 0.63], [0.93, 0.75, 0.22], [0.67, 0.12, 0.08], [0.89, 0.73, 0.28]];
    const productNames = ["CAFE", "TEA", "JUICE", "RICE", "OATS"];
    const interactionCellSize = 2.5;
    const interactionGrid = new Map();
    for (const item of interactiveItems) {
      const cellX = Math.floor(item.x / interactionCellSize);
      const cellZ = Math.floor(item.z / interactionCellSize);
      const key = `${cellX},${cellZ}`;
      let bucket = interactionGrid.get(key);
      if (!bucket) {
        bucket = [];
        interactionGrid.set(key, bucket);
      }
      bucket.push(item);
    }
    const vertexBuffer = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertexBuffer, 0, vertices);
    let dynamicVertexCapacity = 1024 * 1024;
    let dynamicVertexData = new Float32Array(dynamicVertexCapacity / Float32Array.BYTES_PER_ELEMENT);
    let dynamicGeometryDirty = true;
    let dynamicVertexCount = 0;
    let dynamicVertexBuffer = device.createBuffer({
      size: dynamicVertexCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const reflectionVertices = sceneGeometry.reflectionVertices;
    const reflectionVertexBuffer = device.createBuffer({
      size: reflectionVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(reflectionVertexBuffer, 0, reflectionVertices);
    const uniformBuffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const reflectedUniformBuffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const atlas = makeMerchandiseAtlas();
    const merchandiseTexture = device.createTexture({
      size: [atlas.width, atlas.height],
      format: "rgba8unorm-srgb",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: atlas }, { texture: merchandiseTexture }, [atlas.width, atlas.height]);
    const merchandiseSampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
    const emptyReflectionTexture = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: emptyReflectionTexture }, new Uint8Array([0, 0, 0, 0]), { bytesPerRow: 4 }, { width: 1, height: 1 });
    let reflectionTexture = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const shaderModule = device.createShaderModule({ code: shader });
    const compilation = await shaderModule.getCompilationInfo();
    const shaderErrors = compilation.messages.filter((message) => message.type === "error");
    if (shaderErrors.length) throw new Error(shaderErrors.map((message) => message.message).join("\n"));
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
        buffers: [{ arrayStride: 64, attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32x3" },
          { shaderLocation: 3, offset: 36, format: "float32x3" },
          { shaderLocation: 4, offset: 48, format: "float32x2" },
          { shaderLocation: 5, offset: 56, format: "float32" },
          { shaderLocation: 6, offset: 60, format: "float32" },
        ] }],
      },
      fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
    });
    const reflectionPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
        buffers: [{ arrayStride: 64, attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32x3" },
          { shaderLocation: 3, offset: 36, format: "float32x3" },
          { shaderLocation: 4, offset: 48, format: "float32x2" },
          { shaderLocation: 5, offset: 56, format: "float32" },
          { shaderLocation: 6, offset: 60, format: "float32" },
        ] }],
      },
      fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: "rgba8unorm" }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
    });
    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    const reflectedBindGroupLayout = reflectionPipeline.getBindGroupLayout(0);
    const createBindGroup = (reflectionView, uniformResource = uniformBuffer) => device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformResource } },
        { binding: 1, resource: merchandiseTexture.createView() },
        { binding: 2, resource: merchandiseSampler },
        { binding: 3, resource: reflectionView },
      ],
    });
    let bindGroup = createBindGroup(reflectionTexture.createView());
    const mirroredBindGroup = device.createBindGroup({
      layout: reflectedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: reflectedUniformBuffer } },
        { binding: 1, resource: merchandiseTexture.createView() },
        { binding: 2, resource: merchandiseSampler },
        { binding: 3, resource: emptyReflectionTexture.createView() },
      ],
    });

    const camera = { x: 0, y: 1.72, z: 6.5, yaw: 0, pitch: -0.035 };
    const keys = new Set();
    let interactionTarget = null;
    let heldItem = null;
    let pushingCart = null;
    let playerMovementX = 0;
    let playerMovementZ = 0;
    let currentForward = [0, 0, -1];
    let currentRight = [1, 0, 0];
    let jumpHeight = 0;
    let jumpVelocity = 0;
    let grounded = true;
    let locked = false;
    let previousTime = performance.now();
    let walkTime = 0;
    let runTime = 0;
    let stepTimer = 0;
    let sprintingNow = false;
    let runBlend = 0;
    let activeDepthTexture = null;
    let reflectionDepthTexture = null;
    const resizeCanvas = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
      const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
      if (canvas.width === width && canvas.height === height && activeDepthTexture) return;
      canvas.width = width;
      canvas.height = height;
      activeDepthTexture?.destroy();
      reflectionDepthTexture?.destroy();
      reflectionTexture.destroy();
      activeDepthTexture = device.createTexture({ size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const reflectionWidth = Math.max(1, Math.floor(width / 4));
      const reflectionHeight = Math.max(1, Math.floor(height / 4));
      reflectionDepthTexture = device.createTexture({ size: [reflectionWidth, reflectionHeight], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      reflectionTexture = device.createTexture({
        size: [reflectionWidth, reflectionHeight],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      bindGroup = createBindGroup(reflectionTexture.createView());
    };

    const drawVisibleScene = (pass, buffer, reflected = false) => {
      const environmentCount = reflected
        ? sceneGeometry.environmentReflectionVertexCount
        : sceneGeometry.environmentVertexCount;
      const tailStart = reflected ? sceneGeometry.tailReflectionStart : sceneGeometry.tailVertexStart;
      const totalCount = reflected ? reflectionVertices.length / 16 : vertices.length / 16;
      pass.setVertexBuffer(0, buffer);
      if (environmentCount > 0) pass.draw(environmentCount);
      for (const chunk of sceneGeometry.rackChunks) {
        const dx = Math.max(0, Math.abs(camera.x) - 18.5);
        const dz = Math.max(0, Math.abs(camera.z - chunk.centerZ) - 16);
        const visibilityRadius = reflected ? 90 : 180;
        if (dx * dx + dz * dz > visibilityRadius * visibilityRadius) continue;
        const start = reflected ? chunk.reflectionStart : chunk.vertexStart;
        const count = reflected ? chunk.reflectionCount : chunk.vertexCount;
        if (count > 0) pass.draw(count, 1, start);
      }
      if (totalCount > tailStart) pass.draw(totalCount - tailStart, 1, tailStart);
    };

    const playerRadius = 0.34;
    const collidesWithStaticGeometry = (x, z) => {
      for (const shelf of shelfColliders) {
        if (Math.abs(x - shelf.x) < shelf.halfX + playerRadius
          && Math.abs(z - shelf.z) < shelf.halfZ + playerRadius) return true;
      }
      for (const checkout of checkoutColliders) {
        if (Math.abs(x - checkout.x) < checkout.halfX + playerRadius
          && Math.abs(z - checkout.z) < checkout.halfZ + playerRadius) return true;
      }
      return false;
    };

    const collidesWithCart = (x, z) => carts.some((cart) =>
      cart !== pushingCart && Math.hypot(x - cart.x, z - cart.z) < 0.78 + playerRadius);

    const collidesWithOtherCart = (cart, x, z) => carts.some((other) =>
      other !== cart && Math.hypot(x - other.x, z - other.z) < 1.35);

    const hideStaticEntity = (entity) => {
      if (entity.hidden) return;
      if (entity.type === "cart") {
        entity.mesh = vertices.slice(entity.vertexStart, entity.vertexEnd);
        entity.meshPosition = { x: entity.sourceX, y: 0, z: entity.sourceZ };
      } else if (entity.type === "clown") {
        entity.mesh = buildDynamicGeometry(() => toyClown(entity.x, entity.z, 14, 10));
        entity.meshPosition = { x: entity.x, y: 0.27, z: entity.z };
      } else if (entity.type === "balloon") {
        entity.mesh = vertices.slice(entity.vertexStart, entity.vertexEnd);
        entity.meshPosition = { x: entity.x, y: entity.baseY, z: entity.z };
      }
      hideGeometryRange(device, vertexBuffer, vertices, entity.vertexStart, entity.vertexEnd);
      hideGeometryRange(device, reflectionVertexBuffer, reflectionVertices, entity.reflectionStart, entity.reflectionEnd);
      entity.hidden = true;
    };

    const getProductModel = (kind, variant) => {
      const cacheKey = `${kind}:${variant}`;
      if (productModelCache.has(cacheKey)) return productModelCache.get(cacheKey);
      let height;
      const color = productColors[kind][variant % productColors[kind].length];
      const mesh = buildDynamicGeometry(() => {
        if (kind === "chips") {
          height = 0.71 + variant % 3 * 0.04;
          snackBag(0, 1, 0, 0, 0.62, height, color, variant);
        } else if (kind === "box") {
          height = 0.52 + variant % 3 * 0.07;
          boxPackage(0, 1, 0, 0, 0.43 + variant % 2 * 0.05, height, 0.34, color, productAccents[variant], productNames[variant % productNames.length]);
        } else {
          height = 0.64;
          can(0, 1, 0, 0, color);
        }
      });
      const model = {
        mesh,
        meshPosition: { x: 0, y: height / 2, z: 0 },
        height,
        kind,
        variant,
        color,
        label: kind === "chips" ? "Чипсы" : (kind === "box" ? "Коробка" : "Напиток"),
      };
      productModelCache.set(cacheKey, model);
      return model;
    };

    const useFileAudioFallback = import.meta.url.startsWith("file:");
    const fallbackAudioSources = new Map();
    const fallbackSoundSegments = {
      cart: [{ start: 0.33, end: 2.15 }],
      set_setps: [
        { start: 0, end: 0.2 }, { start: 0.88, end: 1.2 }, { start: 1.18, end: 1.5 },
        { start: 1.76, end: 2.3 }, { start: 2.67, end: 2.95 }, { start: 3.6, end: 4.1 },
        { start: 4.55, end: 4.85 }, { start: 5.5, end: 5.9 }, { start: 6.5, end: 6.8 },
        { start: 6.75, end: 7 }, { start: 7.48, end: 7.85 }, { start: 8.5, end: 8.85 },
        { start: 8.75, end: 9.1 },
      ],
      set_slap: [{ start: 1.48, end: 1.95 }],
    };
    const fallbackSoundFiles = [
      ...Array.from({ length: 6 }, (_, index) => `clown${index + 1}`),
      "cart",
      "set_setps",
      "set_slap",
    ];
    if (useFileAudioFallback) {
      for (const name of fallbackSoundFiles) {
        const audio = new Audio(new URL(`./sounds/${name}.mp3`, import.meta.url));
        audio.preload = "auto";
        audio.load();
        fallbackAudioSources.set(name, audio);
      }
    }

    let audioContext = null;
    let cartSoundWanted = false;
    let cartAudioSource = null;
    let cartAudioStarting = false;
    let fallbackCartAudio = null;
    let fallbackCartLoopListener = null;
    let footstepSoundPending = false;
    const fallbackStopListeners = new Map();
    const fallbackSoundCursor = new Map();
    const soundBuffers = new Map();
    const soundSegments = new Map();
    if (!useFileAudioFallback) {
      try {
        audioContext = new AudioContext();
      } catch (error) {
        console.error("Не удалось инициализировать звук:", error);
      }
    }

    const detectSoundSegments = (buffer) => {
      const samples = buffer.getChannelData(0);
      const frameSize = Math.floor(buffer.sampleRate * 0.01);
      const frameCount = Math.ceil(samples.length / frameSize);
      const levels = new Float32Array(frameCount);
      let peak = 0;
      for (let frame = 0; frame < frameCount; frame += 1) {
        const start = frame * frameSize;
        const end = Math.min(start + frameSize, samples.length);
        let energy = 0;
        for (let sample = start; sample < end; sample += 1) energy += samples[sample] * samples[sample];
        levels[frame] = Math.sqrt(energy / (end - start));
        peak = Math.max(peak, levels[frame]);
      }

      const threshold = Math.max(0.004, peak * 0.08);
      const segments = [];
      let start = -1;
      let lastActive = -1;
      for (let frame = 0; frame < frameCount; frame += 1) {
        if (levels[frame] >= threshold) {
          if (start < 0) start = frame;
          lastActive = frame;
        } else if (start >= 0 && frame - lastActive > 12) {
          if (lastActive - start >= 7) {
            segments.push({
              start: Math.max(0, start * frameSize / buffer.sampleRate - 0.04),
              end: Math.min(buffer.duration, (lastActive + 1) * frameSize / buffer.sampleRate + 0.1),
            });
          }
          start = -1;
          lastActive = -1;
        }
      }
      if (start >= 0 && lastActive - start >= 7) {
        segments.push({
          start: Math.max(0, start * frameSize / buffer.sampleRate - 0.04),
          end: Math.min(buffer.duration, (lastActive + 1) * frameSize / buffer.sampleRate + 0.1),
        });
      }
      return segments.length ? segments : [{ start: 0, end: buffer.duration }];
    };

    const soundFiles = [
      ...Array.from({ length: 6 }, (_, index) => `clown${index + 1}`),
      "cart",
      "set_setps",
      "set_slap",
    ];
    const soundLoading = new Map();
    const loadSound = (name) => {
      if (soundBuffers.has(name)) return Promise.resolve(soundBuffers.get(name));
      if (!audioContext) return Promise.resolve(null);
      if (soundLoading.has(name)) return soundLoading.get(name);
      const loading = (async () => {
        try {
          const response = await fetch(`./sounds/${name}.mp3`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
          soundBuffers.set(name, buffer);
          if (["cart", "set_setps", "set_slap"].includes(name)) {
            soundSegments.set(name, detectSoundSegments(buffer));
          }
          return buffer;
        } catch (error) {
          console.error(`Не удалось загрузить звук ${name}:`, error);
          return null;
        }
      })();
      soundLoading.set(name, loading);
      return loading;
    };
    if (audioContext) soundFiles.forEach((name) => { void loadSound(name); });

    const unlockAudio = async () => {
      if (!audioContext || audioContext.state === "running") return true;
      try {
        await audioContext.resume();
        return audioContext.state === "running";
      } catch (error) {
        console.error("Не удалось включить звук:", error);
        return false;
      }
    };

    const getSoundSegment = (name, segments, selectLongestSegment) => {
      if (!segments?.length) return null;
      if (selectLongestSegment) {
        return segments.reduce((longest, candidate) =>
          candidate.end - candidate.start > longest.end - longest.start ? candidate : longest);
      }
      const cursor = fallbackSoundCursor.get(name) || 0;
      fallbackSoundCursor.set(name, cursor + 1);
      return segments[cursor % segments.length];
    };

    const startCartRollingSound = async () => {
      if (cartAudioSource || cartAudioStarting || fallbackCartAudio) return;
      cartAudioStarting = true;
      if (useFileAudioFallback) {
        const audio = fallbackAudioSources.get("cart");
        const segment = getSoundSegment("cart", fallbackSoundSegments.cart, true);
        if (!audio || !segment) {
          cartAudioStarting = false;
          return;
        }
        fallbackCartAudio = audio;
        const startPlayback = () => {
          if (!cartSoundWanted || fallbackCartAudio !== audio) return;
          audio.currentTime = segment.start;
          fallbackCartLoopListener = () => {
            if (cartSoundWanted && audio.currentTime >= segment.end) audio.currentTime = segment.start;
          };
          audio.addEventListener("timeupdate", fallbackCartLoopListener);
          audio.play().catch((error) => {
            console.error("Не удалось воспроизвести звук cart:", error);
            if (fallbackCartLoopListener) audio.removeEventListener("timeupdate", fallbackCartLoopListener);
            fallbackCartLoopListener = null;
            fallbackCartAudio = null;
          });
        };
        if (audio.readyState >= 1) startPlayback();
        else audio.addEventListener("loadedmetadata", startPlayback, { once: true });
        cartAudioStarting = false;
        return;
      }
      if (!audioContext) {
        cartAudioStarting = false;
        return;
      }
      try {
        const [audioUnlocked, buffer] = await Promise.all([unlockAudio(), loadSound("cart")]);
        if (!cartSoundWanted) return;
        if (!audioUnlocked || audioContext.state !== "running") return;
        const segment = getSoundSegment("cart", soundSegments.get("cart"), true);
        if (!buffer || !segment) return;
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = segment.start;
        source.loopEnd = segment.end;
        gain.gain.value = 0.68;
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.start(0, segment.start);
        cartAudioSource = source;
      } catch (error) {
        console.error("Не удалось включить звук тележки:", error);
      } finally {
        cartAudioStarting = false;
      }
    };

    const updateCartRollingSound = (isMoving) => {
      cartSoundWanted = isMoving;
      if (isMoving) {
        void startCartRollingSound();
        return;
      }
      if (cartAudioSource) {
        cartAudioSource.stop();
        cartAudioSource.disconnect();
        cartAudioSource = null;
      }
      if (fallbackCartAudio) {
        fallbackCartAudio.pause();
        fallbackCartAudio.currentTime = 0;
        if (fallbackCartLoopListener) {
          fallbackCartAudio.removeEventListener("timeupdate", fallbackCartLoopListener);
        }
        fallbackCartAudio = null;
        fallbackCartLoopListener = null;
      }
    };

    const playSound = async (name, selectLongestSegment = false) => {
      if (useFileAudioFallback) {
        const audio = fallbackAudioSources.get(name);
        if (!audio) return;
        const segments = fallbackSoundSegments[name];
        const segment = getSoundSegment(name, segments, selectLongestSegment);
        audio.pause();
        const previousStopListener = fallbackStopListeners.get(name);
        if (previousStopListener) audio.removeEventListener("timeupdate", previousStopListener);
        audio.volume = name === "set_setps" ? 0.42 : 0.68;
        const play = () => {
          if (segment) audio.currentTime = segment.start;
          audio.play().catch((error) => console.error(`Не удалось воспроизвести звук ${name}:`, error));
        };
        if (segment) {
          const stopAtSegmentEnd = () => {
            if (audio.currentTime >= segment.end) {
              audio.pause();
              audio.removeEventListener("timeupdate", stopAtSegmentEnd);
              fallbackStopListeners.delete(name);
            }
          };
          fallbackStopListeners.set(name, stopAtSegmentEnd);
          audio.addEventListener("timeupdate", stopAtSegmentEnd);
        }
        if (audio.readyState >= 1) play();
        else audio.addEventListener("loadedmetadata", play, { once: true });
        return;
      }
      if (!audioContext) return;
      const [audioUnlocked, buffer] = await Promise.all([unlockAudio(), loadSound(name)]);
      if (!buffer || !audioUnlocked || audioContext.state !== "running") return;
      const segments = soundSegments.get(name);
      const segment = getSoundSegment(name, segments, selectLongestSegment);
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(audioContext.destination);
      gain.gain.value = name === "set_setps" ? 0.42 : 0.68;
      if (segment) source.start(0, segment.start, segment.end - segment.start);
      else source.start();
    };

    const findInteractionTarget = () => {
      const eye = { x: camera.x, y: camera.y + jumpHeight, z: camera.z };
      let closest = null;
      let closestDistance = 3.7;
      const cellX = Math.floor(eye.x / interactionCellSize);
      const cellZ = Math.floor(eye.z / interactionCellSize);
      const considerCandidate = (candidate) => {
        if (candidate.type === "product" && (!candidate.available || candidate.state !== "shelf")) return;
        if (candidate.type === "cart" && candidate === pushingCart) return;
        const centerY = candidate.type === "clown" ? 0.93
          : (candidate.type === "cart" ? 0.82
            : (candidate.type === "looseProduct" ? candidate.y + candidate.height / 2 : candidate.y));
        const dx = candidate.x - eye.x;
        const dy = centerY - eye.y;
        const dz = candidate.z - eye.z;
        const alongRay = dx * currentForward[0] + dy * currentForward[1] + dz * currentForward[2];
        if (alongRay < 0 || alongRay > closestDistance) return;
        const missX = dx - currentForward[0] * alongRay;
        const missY = dy - currentForward[1] * alongRay;
        const missZ = dz - currentForward[2] * alongRay;
        const aimRadius = candidate.type === "product" ? 0.8 : candidate.radius;
        if (missX * missX + missY * missY + missZ * missZ > aimRadius * aimRadius) return;
        closest = candidate;
        closestDistance = alongRay;
      };
      for (const cart of carts) considerCandidate(cart);
      for (const balloon of balloons) considerCandidate(balloon);
      considerCandidate(toy);
      for (const item of looseProducts) {
        if (item.state === "dropped" && Math.hypot(item.x - eye.x, item.z - eye.z) < closestDistance + 1) {
          considerCandidate(item);
        }
      }
      for (let x = cellX - 2; x <= cellX + 2; x += 1) {
        for (let z = cellZ - 2; z <= cellZ + 2; z += 1) {
          const bucket = interactionGrid.get(`${x},${z}`);
          if (bucket) {
            for (const item of bucket) considerCandidate(item);
          }
        }
      }
      return closest;
    };

    const getInteractionText = (target) => {
      if (heldItem) {
        if (target?.type === "cart") return target.contents.length >= 3 ? "тележка заполнена" : "положить в тележку";
        return `бросить: ${heldItem.label}`;
      }
      if (pushingCart) return "толкнуть тележку";
      if (!target) return "";
      if (target.type === "clown") return "толкнуть неваляшку";
      if (target.type === "balloon") return "ударить по шарику";
      if (target.type === "cart") return "взяться за тележку";
      return `взять: ${target.label}`;
    };

    let displayedInteractionText = "";
    const updateInteractionHint = () => {
      interactionTarget = findInteractionTarget();
      const text = getInteractionText(interactionTarget);
      if (text === displayedInteractionText) return;
      displayedInteractionText = text;
      interactionLabel.textContent = text;
      interactionHint.classList.toggle("visible", Boolean(text));
    };

    const beginHoldingItem = (item) => {
      if (item.type === "looseProduct") {
        looseProducts.splice(looseProducts.indexOf(item), 1);
      } else {
        const variant = Math.floor(Math.random() * 8);
        const model = getProductModel(item.kind, variant);
        item = {
          type: "looseProduct",
          mesh: model.mesh,
          meshPosition: model.meshPosition,
          sourceYaw: 0,
          height: model.height,
          radius: 0.42,
          kind: model.kind,
          variant: model.variant,
          color: model.color,
          label: model.label,
          state: "held",
          vx: 0,
          vy: 0,
          vz: 0,
        };
      }
      item.holdYawOffset = -Math.PI / 2;
      item.sourceYaw = 0;
      item.state = "held";
      heldItem = item;
      dynamicGeometryDirty = true;
    };

    const throwHeldItem = () => {
      const item = heldItem;
      if (!item) return;
      item.state = "thrown";
      item.x = camera.x + currentForward[0] * 0.95;
      item.y = camera.y + jumpHeight - item.height * 0.75;
      item.z = camera.z + currentForward[2] * 0.95;
      item.yaw = -camera.yaw + item.holdYawOffset;
      item.vx = currentForward[0] * 12.5;
      item.vy = currentForward[1] * 7 + 4.1;
      item.vz = currentForward[2] * 12.5;
      item.floorY = item.height / 2 + 0.04;
      looseProducts.push(item);
      heldItem = null;
      dynamicGeometryDirty = true;
    };

    const storeHeldItem = (cart) => {
      if (!heldItem) return;
      if (cart.contents.length >= 3) return;
      heldItem.yaw = cart.yaw - Math.PI / 2;
      heldItem.state = "stored";
      heldItem.cart = cart;
      cart.contents.push(heldItem);
      heldItem = null;
      dynamicGeometryDirty = true;
    };

    const interact = () => {
      if (heldItem) {
        if (interactionTarget?.type === "cart" && interactionTarget.contents.length < 3) storeHeldItem(interactionTarget);
        else if (interactionTarget?.type === "cart") return;
        else throwHeldItem();
        return;
      }
      if (pushingCart) {
        pushingCart.vx = currentForward[0] * 10.5;
        pushingCart.vz = currentForward[2] * 10.5;
        pushingCart.active = true;
        pushingCart = null;
        dynamicGeometryDirty = true;
        return;
      }
      const target = interactionTarget;
      if (!target) return;
      if (target.type === "product" || target.type === "looseProduct") {
        beginHoldingItem(target);
      } else if (target.type === "clown") {
        unlockAudio();
        void playSound(`clown${Math.floor(Math.random() * 6) + 1}`);
        const side = Math.sign(camera.x - toy.x) || 1;
        if (!toy.active) {
          hideStaticEntity(toy);
          toy.active = true;
        }
        toy.angularVelocity += side * 2.7;
        dynamicGeometryDirty = true;
      } else if (target.type === "balloon") {
        unlockAudio();
        void playSound("set_slap");
        if (!target.active) {
          hideStaticEntity(target);
          target.active = true;
        }
        target.vx += currentForward[0] * 8.5;
        target.vy += 4.2 + Math.max(0, currentForward[1]) * 2;
        target.vz += currentForward[2] * 8.5;
        dynamicGeometryDirty = true;
      } else if (target.type === "cart") {
        hideStaticEntity(target);
        target.active = true;
        target.vx = 0;
        target.vz = 0;
        const frontX = camera.x + currentForward[0] * 1.35;
        const frontZ = camera.z + currentForward[2] * 1.35;
        const frontYaw = -camera.yaw;
        if (!cartCollidesWithShelves(target, frontX, frontZ, frontYaw)
          && !collidesWithOtherCart(target, frontX, frontZ)) {
          target.x = frontX;
          target.z = frontZ;
          target.yaw = frontYaw;
        }
        pushingCart = target;
        unlockAudio();
        dynamicGeometryDirty = true;
      }
    };

    const cartCollidesWithShelves = (cart, x, z, yaw) => {
      const cartHalfX = Math.abs(Math.cos(yaw)) * 0.46 + Math.abs(Math.sin(yaw)) * 0.68;
      const cartHalfZ = Math.abs(Math.sin(yaw)) * 0.46 + Math.abs(Math.cos(yaw)) * 0.68;
      for (const rackX of [-18, -12, -6, 6, 12, 18]) {
        for (let section = 0; section < 23; section += 1) {
          const rackZ = -7 - section * 9.35 - Math.floor(section / 3) * 2.6;
          if (Math.abs(x - rackX) < cartHalfX + 0.57
            && Math.abs(z - rackZ) < cartHalfZ + 4.675) return true;
        }
      }
      return false;
    };

    const updateInteractiveObjects = (delta) => {
      if (delta <= 0) return false;
      let geometryChanged = false;
      const damping = Math.exp(-2.2 * delta);
      if (toy.active && (toy.tilt !== 0 || toy.angularVelocity !== 0)) {
        geometryChanged = true;
        toy.angularVelocity += -14 * Math.sin(toy.tilt) * delta;
        toy.angularVelocity *= Math.exp(-1.45 * delta);
        toy.tilt += toy.angularVelocity * delta;
        if (Math.abs(toy.tilt) > 1.25) {
          toy.tilt = Math.sign(toy.tilt) * 1.25;
          toy.angularVelocity *= -0.3;
        }
        if (Math.abs(toy.tilt) < 0.004 && Math.abs(toy.angularVelocity) < 0.015) {
          toy.tilt = 0;
          toy.angularVelocity = 0;
        }
      }

      for (const balloon of balloons) {
        if (!balloon.active) continue;
        if (balloon.vx !== 0 || balloon.vy !== 0 || balloon.vz !== 0 || balloon.y !== balloon.baseY) geometryChanged = true;
        balloon.x += balloon.vx * delta;
        balloon.z += balloon.vz * delta;
        balloon.y += balloon.vy * delta;
        balloon.vx *= damping;
        balloon.vz *= damping;
        balloon.vy += (balloon.baseY - balloon.y) * 3.2 * delta;
        balloon.vy *= Math.exp(-1.5 * delta);
        if (Math.abs(balloon.y - balloon.baseY) < 0.002 && Math.abs(balloon.vy) < 0.015) {
          balloon.y = balloon.baseY;
          balloon.vy = 0;
        }
        if (Math.abs(balloon.x) > 20 || Math.abs(balloon.z) > 240) {
          balloon.x = Math.max(-20, Math.min(20, balloon.x));
          balloon.z = Math.max(-240, Math.min(7, balloon.z));
          balloon.vx = 0;
          balloon.vz = 0;
        }
        if (Math.hypot(balloon.vx, balloon.vz) < 0.08) {
          balloon.vx = 0;
          balloon.vz = 0;
        }
      }

      for (const cart of carts) {
        if (cart === pushingCart) {
          const nextX = camera.x + currentForward[0] * 1.35;
          const nextZ = camera.z + currentForward[2] * 1.35;
          const nextYaw = -camera.yaw;
          if (!cartCollidesWithShelves(cart, nextX, nextZ, nextYaw)
            && !collidesWithOtherCart(cart, nextX, nextZ)) {
            if (Math.abs(cart.x - nextX) > 0.001 || Math.abs(cart.z - nextZ) > 0.001
              || Math.abs(cart.yaw - nextYaw) > 0.001) geometryChanged = true;
            cart.x = nextX;
            cart.z = nextZ;
            cart.yaw = nextYaw;
          } else if (playerMovementX !== 0 || playerMovementZ !== 0) {
            camera.x -= playerMovementX;
            camera.z -= playerMovementZ;
            playerMovementX = 0;
            playerMovementZ = 0;
          }
          continue;
        }
        if (!cart.active) continue;
        geometryChanged = true;
        const nextX = cart.x + cart.vx * delta;
        const nextZ = cart.z + cart.vz * delta;
        if (Math.abs(nextX) > 20 || Math.abs(nextZ) > 240
          || cartCollidesWithShelves(cart, nextX, nextZ, cart.yaw)
          || collidesWithOtherCart(cart, nextX, nextZ)) {
          cart.vx = 0;
          cart.vz = 0;
        } else {
          cart.x = nextX;
          cart.z = nextZ;
        }
        cart.vx *= damping;
        cart.vz *= damping;
        if (Math.hypot(cart.vx, cart.vz) < 0.08) {
          cart.vx = 0;
          cart.vz = 0;
          cart.active = false;
        }
      }

      for (const item of looseProducts) {
        if (item.state !== "thrown") continue;
        geometryChanged = true;
        item.vy -= 12 * delta;
        item.x += item.vx * delta;
        item.y += item.vy * delta;
        item.z += item.vz * delta;
        item.vx *= Math.exp(-0.3 * delta);
        item.vz *= Math.exp(-0.3 * delta);
        if (item.y <= item.floorY) {
          item.y = item.floorY;
          item.vy = Math.abs(item.vy) > 1 ? item.vy * -0.24 : 0;
          item.vx *= 0.72;
          item.vz *= 0.72;
        }
        if (Math.hypot(item.vx, item.vy, item.vz) < 0.16 && item.y <= item.floorY + 0.02) {
          item.state = "dropped";
          item.vx = 0;
          item.vy = 0;
          item.vz = 0;
        }
      }
      if (geometryChanged) dynamicGeometryDirty = true;
      return geometryChanged;
    };

    let dynamicVertexWriteOffset = 0;
    const appendTransformedItem = (item, target, yaw, scale = 1, pitch = 0, pivotY = 0) => {
      if (!item.mesh) return;
      const sourcePosition = item.meshPosition || { x: item.x, y: item.shelfY + item.height / 2, z: item.z };
      if (!item.meshPosition) item.meshPosition = sourcePosition;
      const deltaYaw = yaw - (item.sourceYaw || 0);
      if (!item.transformedMesh || item.transformedMesh.length !== item.mesh.length) {
        item.transformedMesh = new Float32Array(item.mesh.length);
      }
      const transformed = transformMesh(
        item.mesh,
        sourcePosition,
        target,
        deltaYaw,
        scale,
        item.transformedMesh,
        pitch,
        pivotY,
      );
      const requiredLength = dynamicVertexWriteOffset + transformed.length;
      if (requiredLength > dynamicVertexData.length) {
        const capacity = 2 ** Math.ceil(Math.log2(requiredLength));
        const expandedData = new Float32Array(capacity);
        expandedData.set(dynamicVertexData);
        dynamicVertexData = expandedData;
      }
      dynamicVertexData.set(transformed, dynamicVertexWriteOffset);
      dynamicVertexWriteOffset = requiredLength;
    };

    const createDynamicVertices = () => {
      dynamicVertexWriteOffset = 0;
      if (toy.active) {
        const pivot = { x: toy.x, y: 0.27, z: toy.z };
        appendTransformedItem(toy, pivot, 0, 1, toy.tilt);
      }
      for (const balloon of balloons) {
        if (!balloon.active) continue;
        appendTransformedItem(balloon, { x: balloon.x, y: balloon.y, z: balloon.z }, 0);
      }
      for (const cart of carts) {
        if (cart.hidden || cart.active || cart === pushingCart) {
          appendTransformedItem(
            cart,
            { x: cart.x, y: 0, z: cart.z },
            cart.yaw,
          );
        }
        for (const [index, item] of cart.contents.entries()) {
          const localZ = (index - 1) * 0.4;
          const itemPosition = {
            x: cart.x + localZ * Math.sin(cart.yaw),
            y: 0.59 + item.height * 0.29,
            z: cart.z + localZ * Math.cos(cart.yaw),
          };
          appendTransformedItem(item, itemPosition, cart.yaw - Math.PI / 2, 0.58);
        }
      }
      if (heldItem) {
        const target = {
          x: camera.x + currentForward[0] * 0.82 + currentRight[0] * 0.34,
          y: camera.y + jumpHeight - 0.45,
          z: camera.z + currentForward[2] * 0.82 + currentRight[2] * 0.34,
        };
        appendTransformedItem(heldItem, target, -camera.yaw + heldItem.holdYawOffset);
      }
      for (const item of looseProducts) {
        if (item.state !== "thrown" && item.state !== "dropped") continue;
        appendTransformedItem(item, item, item.yaw);
      }
      return dynamicVertexWriteOffset;
    };

    const uploadDynamicVertices = (floatCount) => {
      const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
      if (byteLength > dynamicVertexCapacity) {
        dynamicVertexBuffer.destroy();
        dynamicVertexCapacity = 2 ** Math.ceil(Math.log2(byteLength));
        dynamicVertexBuffer = device.createBuffer({
          size: dynamicVertexCapacity,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }
      if (byteLength > 0) {
        device.queue.writeBuffer(dynamicVertexBuffer, 0, dynamicVertexData.subarray(0, floatCount));
      }
      return floatCount / 16;
    };

    const updateUniforms = (time, delta, reflectionPass) => {
      const forward = [
        Math.sin(camera.yaw) * Math.cos(camera.pitch),
        Math.sin(camera.pitch),
        -Math.cos(camera.yaw) * Math.cos(camera.pitch),
      ];
      const right = [Math.cos(camera.yaw), 0, Math.sin(camera.yaw)];
      currentForward = forward;
      currentRight = right;
      const running = keys.has("ShiftLeft") || keys.has("ShiftRight");
      let moveX = 0;
      let moveZ = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) { moveX += forward[0]; moveZ += forward[2]; }
      if (keys.has("KeyS") || keys.has("ArrowDown")) { moveX -= forward[0]; moveZ -= forward[2]; }
      if (keys.has("KeyD") || keys.has("ArrowRight")) { moveX += right[0]; moveZ += right[2]; }
      if (keys.has("KeyA") || keys.has("ArrowLeft")) { moveX -= right[0]; moveZ -= right[2]; }
      const moveLength = Math.hypot(moveX, moveZ);
      const sprinting = running && moveLength > 0;
      sprintingNow = sprinting;
      const pace = sprinting ? 9.5 : 4.1;
      playerMovementX = 0;
      playerMovementZ = 0;
      if (delta > 0 && !grounded) {
        jumpVelocity -= 20 * delta;
        jumpHeight += jumpVelocity * delta;
        if (jumpHeight <= 0) {
          jumpHeight = 0;
          jumpVelocity = 0;
          grounded = true;
        }
      }
      if (moveLength > 0) {
        const stepX = moveX / moveLength * pace * delta;
        const stepZ = moveZ / moveLength * pace * delta;
        const candidateX = Math.max(-21.55, Math.min(21.55, camera.x + stepX));
        const candidateZ = Math.max(-241.55, Math.min(7.55, camera.z + stepZ));
        if (!collidesWithStaticGeometry(candidateX, camera.z) && !collidesWithCart(candidateX, camera.z)) {
          playerMovementX = candidateX - camera.x;
          camera.x = candidateX;
        }
        if (!collidesWithStaticGeometry(camera.x, candidateZ) && !collidesWithCart(camera.x, candidateZ)) {
          playerMovementZ = candidateZ - camera.z;
          camera.z = candidateZ;
        }
        walkTime += delta * pace;
      }
      if (delta > 0) {
        runTime += delta;
        const runTarget = sprinting ? 1 : 0;
        runBlend += (runTarget - runBlend) * (1 - Math.exp(-delta * 7));
      }
      const walkBob = moveLength > 0 ? Math.sin(walkTime * 2.5) * 0.022 * (1 - runBlend) : 0;
      const runSwayX = Math.sin(runTime * 4.5) * 0.006 * runBlend;
      const runSwayY = Math.sin(runTime * 9) * 0.016 * runBlend;
      const view = viewMatrix([
        camera.x + runSwayX,
        camera.y + jumpHeight + walkBob + runSwayY,
        camera.z,
      ], forward);
      const projection = perspective(Math.PI / 3, canvas.width / canvas.height, 0.1, 260);
      const uniforms = new Float32Array(24);
      uniforms.set(multiplyMatrices(projection, view), 0);
      uniforms.set([camera.x, camera.y, camera.z, time / 1000], 16);
      uniforms.set([
        reflectionPass ? 1 : 0,
        Math.max(1, Math.floor(canvas.width / 4)),
        Math.max(1, Math.floor(canvas.height / 4)),
        0,
      ], 20);
      device.queue.writeBuffer(reflectionPass ? reflectedUniformBuffer : uniformBuffer, 0, uniforms);
    };

    const render = (time) => {
      resizeCanvas();
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      updateUniforms(time, delta, true);
      updateInteractiveObjects(delta);
      const cartIsRolling = carts.some((cart) =>
        (cart === pushingCart && Math.hypot(playerMovementX, playerMovementZ) > 0.001)
        || (cart.active && Math.hypot(cart.vx, cart.vz) > 0.15));
      updateCartRollingSound(cartIsRolling);
      if (delta > 0 && Math.hypot(playerMovementX, playerMovementZ) > 0.0001) {
        stepTimer -= delta;
        if (stepTimer <= 0 && !footstepSoundPending) {
          footstepSoundPending = true;
          void playSound("set_setps").finally(() => { footstepSoundPending = false; });
          stepTimer = sprintingNow ? 0.32 : 0.44;
        }
      } else {
        stepTimer = 0;
      }
      updateInteractionHint();
      if (heldItem) dynamicGeometryDirty = true;
      if (dynamicGeometryDirty) {
        dynamicVertexCount = uploadDynamicVertices(createDynamicVertices());
        dynamicGeometryDirty = false;
      }
      const encoder = device.createCommandEncoder();
      const reflectionPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: reflectionTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: reflectionDepthTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      reflectionPass.setPipeline(reflectionPipeline);
      reflectionPass.setBindGroup(0, mirroredBindGroup);
      drawVisibleScene(reflectionPass, reflectionVertexBuffer, true);
      if (dynamicVertexCount > 0) {
        reflectionPass.setVertexBuffer(0, dynamicVertexBuffer);
        reflectionPass.draw(dynamicVertexCount);
      }
      reflectionPass.end();
      updateUniforms(time, 0, false);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.47, g: 0.43, b: 0.37, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: activeDepthTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      drawVisibleScene(pass, vertexBuffer);
      if (dynamicVertexCount > 0) {
        pass.setVertexBuffer(0, dynamicVertexBuffer);
        pass.draw(dynamicVertexCount);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(render);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    document.addEventListener("keydown", (event) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)
        || (["Space", "KeyE"].includes(event.code) && document.body.classList.contains("playing"))) event.preventDefault();
      keys.add(event.code);
      if (event.code === "KeyE" && !event.repeat && document.body.classList.contains("playing")) interact();
      if (event.code === "Space" && !event.repeat && document.body.classList.contains("playing") && grounded) {
        jumpVelocity = 7.2;
        grounded = false;
      }
      if (event.code === "Escape" && document.pointerLockElement !== canvas) stopWalking();
    });
    document.addEventListener("keyup", (event) => keys.delete(event.code));
    window.addEventListener("blur", () => keys.clear());
    document.addEventListener("mousemove", (event) => {
      if (!locked) return;
      camera.yaw += event.movementX * 0.002;
      camera.pitch = Math.max(-1.1, Math.min(1.05, camera.pitch - event.movementY * 0.0018));
    });
    document.addEventListener("pointerlockchange", () => {
      locked = document.pointerLockElement === canvas;
      if (!locked && document.body.classList.contains("playing")) stopWalking();
    });

    function stopWalking() {
      keys.clear();
      if (heldItem) throwHeldItem();
      if (pushingCart) {
        pushingCart.vx = 0;
        pushingCart.vz = 0;
        pushingCart.active = true;
        pushingCart = null;
      }
      document.body.classList.remove("playing");
      hud.classList.remove("active");
      intro.style.opacity = "1";
      canvas.classList.remove("interactive");
      interactionHint.classList.remove("visible");
      displayedInteractionText = "";
      document.exitPointerLock?.();
    }

    enterButton.addEventListener("click", async () => {
      document.body.classList.add("playing");
      hud.classList.add("active");
      intro.style.opacity = "0";
      canvas.classList.add("interactive");
      unlockAudio();
      try {
        await canvas.requestPointerLock();
      } catch (error) {
        console.error("Не удалось включить управление мышью:", error);
      }
    });
    leaveButton.addEventListener("click", stopWalking);
    canvas.addEventListener("click", () => {
      if (document.body.classList.contains("playing") && !locked) canvas.requestPointerLock();
    });
    requestAnimationFrame(render);
    loading.classList.add("hidden");
    window.setInterval(() => {
      const now = new Date();
      clockLabel.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    }, 1000);
  } catch (error) {
    console.error("Не удалось запустить сцену WebGPU:", error);
    loading.classList.add("hidden");
    errorMessage.hidden = false;
    errorMessage.textContent = `Не удалось загрузить магазин: ${error.message}`;
  }
}

start();
