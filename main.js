const canvas = document.querySelector("#scene");
const loading = document.querySelector("#loading");
const errorMessage = document.querySelector("#webgpuError");
const enterButton = document.querySelector("#enter");
const leaveButton = document.querySelector("#leave");
const intro = document.querySelector("#intro");
const hud = document.querySelector("#hud");
const clockLabel = document.querySelector("#clock");
const vertexData = [];
const reflectedVertexData = [];
let captureReflection = false;

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
  worldPosition.y += sin(scene.cameraAndTime.w * 1.15 + input.position.z * 0.23 + input.position.x * 0.19) * 0.16 * input.animation;
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
  let objectSpecular = pow(max(dot(normal, halfDirection), 0.0), 34.0) * input.animation * 0.48;
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
    let pixel = vec2<i32>(input.clipPosition.xy * 0.5);
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
  const [a, b, c, d] = points;
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
  const vertices = [
    [a, uv[0], options.normals?.[0]], [b, uv[1], options.normals?.[1]], [c, uv[2], options.normals?.[2]],
    [a, uv[0], options.normals?.[0]], [c, uv[2], options.normals?.[2]], [d, uv[3], options.normals?.[3]],
  ];
  const packedVertices = [];
  for (const [point, texCoord, vertexNormal] of vertices) {
    packedVertices.push(
      ...point, ...color, ...(vertexNormal || n), ...(options.emission || [0, 0, 0]),
      ...texCoord, options.textured ? 1 : 0, options.animation || 0,
    );
  }
  vertexData.push(...packedVertices);
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
  const v0 = row / 4 + inset;
  const v1 = (row + 1) / 4 - inset;
  quad(points, [1, 1, 1], {
    textured: true,
    uv: [[u0, v1], [u1, v1], [u1, v0], [u0, v0]],
  });
}

function snackBag(x, inward, y, z, width, height, color, cell) {
  const depth = 0.25;
  box(x, y + height * 0.5, z, depth, height * 0.98, width * 0.86, color);
  productPanel(x + inward * (depth / 2 + 0.003), inward, y + 0.012, y + height * 0.97, z, width * 0.84, cell);
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
};

function frontText(x, inward, centerY, centerZ, text, pixelHeight, pixelWidth, color) {
  const gap = pixelWidth * 0.45;
  const textWidth = text.length * 3 * pixelWidth + (text.length - 1) * gap;
  let cursorZ = centerZ + textWidth / 2;
  const frontX = x + inward * 0.006;
  for (const character of text) {
    const glyph = frontGlyphs[character];
    if (!glyph) {
      cursorZ -= pixelWidth * 2 + gap;
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        const z0 = cursorZ - (column + 1) * pixelWidth;
        const z1 = cursorZ - column * pixelWidth;
        const y0 = centerY + (glyph.length / 2 - row - 1) * pixelHeight;
        const y1 = y0 + pixelHeight * 0.82;
        const points = inward > 0
          ? [[frontX, y0, z1], [frontX, y0, z0], [frontX, y1, z0], [frontX, y1, z1]]
          : [[frontX, y0, z0], [frontX, y0, z1], [frontX, y1, z1], [frontX, y1, z0]];
        quad(points, color);
      }
    }
    cursorZ -= 3 * pixelWidth + gap;
  }
}

function boxPackage(x, inward, y, z, width, height, depth, color, accent, productName) {
  box(x, y + height / 2, z, depth, height, width, color);
  const panelX = x + inward * (depth / 2 + 0.003);
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
  frontText(panelX, inward, badgeY, badgeZ, "24", height * 0.024, width * 0.055, [0.19, 0.16, 0.12]);
  frontText(panelX, inward, y + height * 0.37, z, productName, height * 0.018, width * 0.042, [0.98, 0.93, 0.81]);
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
  const backX = x - inward * (depth / 2 + 0.003);
  const backPoints = inward > 0
    ? [[backX, y0, z - width * 0.47], [backX, y0, z + width * 0.47], [backX, y1, z + width * 0.47], [backX, y1, z - width * 0.47]]
    : [[backX, y0, z + width * 0.47], [backX, y0, z - width * 0.47], [backX, y1, z - width * 0.47], [backX, y1, z + width * 0.47]];
  quad(backPoints, tint(accent, 0.64));
  frontText(backX, -inward, y + height * 0.7, z, "24", height * 0.021, width * 0.05, [0.2, 0.17, 0.13]);
  frontText(backX, -inward, y + height * 0.38, z, productName, height * 0.016, width * 0.037, [0.98, 0.93, 0.81]);
  for (const sideZ of [z - width / 2 - 0.003, z + width / 2 + 0.003]) {
    quad([
      [x - depth * 0.47, y0, sideZ],
      [x + depth * 0.47, y0, sideZ],
      [x + depth * 0.47, y1, sideZ],
      [x - depth * 0.47, y1, sideZ],
    ], tint(accent, 0.78));
    const sidePoints = [
      [x - depth * 0.47, y + height * 0.1, sideZ],
      [x + depth * 0.47, y + height * 0.1, sideZ],
      [x + depth * 0.47, y + height * 0.16, sideZ],
      [x - depth * 0.47, y + height * 0.16, sideZ],
    ];
    quad(sidePoints, [0.95, 0.85, 0.58]);
    const sideStripe = [
      [x - depth * 0.47, y + height * 0.78, sideZ],
      [x + depth * 0.47, y + height * 0.78, sideZ],
      [x + depth * 0.47, y + height * 0.84, sideZ],
      [x - depth * 0.47, y + height * 0.84, sideZ],
    ];
    quad(sideStripe, tint(color, 1.5));
  }
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
  atlas.height = 512;
  const context = atlas.getContext("2d");
  if (!context) throw new Error("Не удалось создать текстуры товаров.");
  const colors = [
    ["#c52c19", "#f7b632"], ["#e87817", "#ffe072"], ["#e4b326", "#a61d12"], ["#153b7c", "#e7b733"],
    ["#397541", "#f1d75d"], ["#ab2332", "#f4d293"], ["#25262a", "#e5aa37"], ["#bd651e", "#f6d48a"],
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
  return atlas;
}

function ellipsoid(cx, cy, cz, radiusX, radiusY, radiusZ, color, animation = 0, balloonShape = false) {
  const segments = 40;
  const rings = 28;
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

function makeScene() {
  vertexData.length = 0;
  reflectedVertexData.length = 0;
  captureReflection = false;
  quad([[-22, -0.055, 8], [22, -0.055, 8], [22, -0.055, -212], [-22, -0.055, -212]], [0.43, 0.39, 0.32]);
  const floorTileColors = [[0.66, 0.59, 0.48], [0.61, 0.55, 0.45], [0.69, 0.62, 0.51], [0.64, 0.57, 0.47]];
  const floorColumns = 30;
  const floorRows = 150;
  const floorTileWidth = 44 / floorColumns;
  const floorTileDepth = 220 / floorRows;
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

  quad([[-22, 9.34, 8], [-22, 9.34, -212], [22, 9.34, -212], [22, 9.34, 8]], [0.43, 0.4, 0.34]);
  const ceilingColors = [[0.62, 0.58, 0.51], [0.57, 0.53, 0.47], [0.65, 0.61, 0.54], [0.6, 0.56, 0.49]];
  for (let row = 0; row < 110; row += 1) {
    for (let column = 0; column < 22; column += 1) {
      const x = -21 + column * 2;
      const z = 7 - row * 2;
      const color = ceilingColors[(row * 3 + column * 5) % ceilingColors.length];
      quad([[x - 0.97, 9.29, z], [x - 0.97, 9.29, z - 1.95], [x + 0.97, 9.29, z - 1.95], [x + 0.97, 9.29, z]], color);
    }
  }

  box(-22.2, 4.45, -101, 0.4, 9, 220, [0.66, 0.59, 0.49]);
  box(22.2, 4.45, -101, 0.4, 9, 220, [0.66, 0.59, 0.49]);
  box(0, 9.52, -101, 44.8, 0.32, 220, [0.49, 0.45, 0.38]);
  box(0, 4.45, -212, 44.8, 9, 0.5, [0.54, 0.48, 0.39]);

  const rackCenters = [-18, -12, -6, 6, 12, 18];
  const chipColors = [
    [0.82, 0.11, 0.07], [0.91, 0.32, 0.06], [0.93, 0.69, 0.08], [0.08, 0.28, 0.59],
    [0.13, 0.43, 0.21], [0.72, 0.13, 0.29], [0.91, 0.83, 0.65], [0.15, 0.16, 0.16],
  ];
  const boxColors = [[0.68, 0.18, 0.09], [0.83, 0.58, 0.12], [0.13, 0.32, 0.48], [0.34, 0.49, 0.25], [0.72, 0.3, 0.18]];
  const drinkColors = [[0.57, 0.08, 0.07], [0.14, 0.17, 0.15], [0.77, 0.57, 0.12], [0.08, 0.28, 0.54]];
  const accents = [[0.99, 0.78, 0.18], [0.96, 0.83, 0.59], [0.76, 0.12, 0.07], [0.95, 0.8, 0.53], [0.92, 0.83, 0.63], [0.93, 0.75, 0.22], [0.67, 0.12, 0.08], [0.89, 0.73, 0.28]];
  for (let rackIndex = 0; rackIndex < rackCenters.length; rackIndex += 1) {
    const x = rackCenters[rackIndex];
    for (let section = 0; section < 23; section += 1) {
      const z = -7 - section * 9.35;
      const runLength = 8.9;
      captureReflection = true;
      for (const shelfY of [0.045, 1.015, 1.985, 2.955, 3.925]) {
        box(x, shelfY, z, shelfY === 3.915 ? 1.04 : 1.02, 0.14, runLength, [0.67, 0.65, 0.57]);
      }
      for (let post = 0; post < 5; post += 1) {
        box(x, 2.09, z - 4.25 + post * 2.12, 0.055, 4.25, 0.055, [0.49, 0.55, 0.44]);
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
            if (isDrinksShelf) {
              can(productX, facing, shelfY, productZ, drinkColors[variant % drinkColors.length]);
            } else if (isBoxShelf) {
              const height = 0.52 + variant % 3 * 0.07;
              const productNames = ["CAFE", "TEA", "JUICE", "RICE", "OATS"];
              boxPackage(productX, facing, shelfY, productZ, 0.43 + variant % 2 * 0.05, height, 0.34, boxColors[variant % boxColors.length], accents[variant], productNames[variant % productNames.length]);
            } else {
              const height = 0.71 + variant % 3 * 0.04;
              snackBag(productX, facing, shelfY, productZ, 0.62, height, chipColors[variant], variant);
            }
            captureReflection = false;
          }
          captureReflection = true;
          const railX = x + facing * 0.5;
          box(railX, shelfY + 0.15, z, 0.035, 0.035, 8.95, [0.72, 0.71, 0.64]);
          box(railX, shelfY + 0.28, z, 0.03, 0.025, 8.95, [0.72, 0.71, 0.64]);
          for (let tag = 0; tag < 5; tag += 1) {
            box(x + facing * 0.53, shelfY + 0.035, z - 3.8 + tag * 1.9, 0.025, 0.09, 0.55, [0.91, 0.85, 0.68]);
          }
          captureReflection = false;
        }
      }
      captureReflection = true;
      box(x, 4.38, z - 4.34, 1.04, 0.27, 0.07, [0.74, 0.23, 0.13]);
      captureReflection = false;
    }
  }

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
  captureReflection = false;

  for (let light = 0; light < 28; light += 1) {
    const z = 4 - light * 7.7;
    for (const x of [-18, -12, -6, 0, 6, 12, 18]) {
      captureReflection = true;
      box(x, 8.86, z, 1.48, 0.2, 4.35, [0.61, 0.57, 0.49]);
      box(x, 8.735, z, 1.08, 0.055, 3.82, [0.98, 0.93, 0.8], [0.72, 0.58, 0.4]);
      captureReflection = false;
    }
  }

  const balloons = [
    [-3.5, -12, [0.87, 0.31, 0.25]], [-2.6, -12.8, [0.18, 0.34, 0.78]], [-1.7, -11.7, [0.91, 0.68, 0.12]],
    [3.2, -45, [0.79, 0.68, 0.39]], [-3.5, -79, [0.45, 0.68, 0.59]], [3.5, -108, [0.84, 0.39, 0.47]],
    [0, -117, [0.82, 0.69, 0.38]], [-18, -147, [0.54, 0.65, 0.79]], [18, -177, [0.82, 0.38, 0.29]],
  ];
  for (let i = 0; i < balloons.length; i += 1) {
    const [x, z, color] = balloons[i];
    const y = 2.65 + (i % 3) * 0.28;
    captureReflection = true;
    ellipsoid(x, y, z, 0.39, 0.51, 0.35, color, 1, true);
    box(x, y - 1.08, z, 0.014, 1.32, 0.014, [0.55, 0.45, 0.34], [0, 0, 0], 1);
    box(x, y - 0.52, z, 0.045, 0.09, 0.045, tint(color, 0.75), [0, 0, 0], 1);
    captureReflection = false;
  }
  box(0, 6.9, -211.6, 8, 1.15, 0.18, [0.48, 0.18, 0.12]);
  return {
    vertices: new Float32Array(vertexData),
    reflectionVertices: new Float32Array(reflectedVertexData),
    floorVertexCount,
  };
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
    const vertexBuffer = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertexBuffer, 0, vertices);
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

    const camera = { x: 0, y: 1.72, z: 8, yaw: 0, pitch: -0.035 };
    const keys = new Set();
    let locked = false;
    let previousTime = performance.now();
    let walkTime = 0;
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
      const reflectionWidth = Math.max(1, Math.floor(width / 2));
      const reflectionHeight = Math.max(1, Math.floor(height / 2));
      reflectionDepthTexture = device.createTexture({ size: [reflectionWidth, reflectionHeight], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      reflectionTexture = device.createTexture({
        size: [reflectionWidth, reflectionHeight],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      bindGroup = createBindGroup(reflectionTexture.createView());
    };

    const updateUniforms = (time, delta, reflectionPass) => {
      const forward = [
        Math.sin(camera.yaw) * Math.cos(camera.pitch),
        Math.sin(camera.pitch),
        -Math.cos(camera.yaw) * Math.cos(camera.pitch),
      ];
      const right = [Math.cos(camera.yaw), 0, Math.sin(camera.yaw)];
      const pace = keys.has("Shift") ? 7.1 : 4.1;
      let moveX = 0;
      let moveZ = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) { moveX += forward[0]; moveZ += forward[2]; }
      if (keys.has("KeyS") || keys.has("ArrowDown")) { moveX -= forward[0]; moveZ -= forward[2]; }
      if (keys.has("KeyD") || keys.has("ArrowRight")) { moveX += right[0]; moveZ += right[2]; }
      if (keys.has("KeyA") || keys.has("ArrowLeft")) { moveX -= right[0]; moveZ -= right[2]; }
      const moveLength = Math.hypot(moveX, moveZ);
      if (moveLength > 0) {
        camera.x = Math.max(-21, Math.min(21, camera.x + moveX / moveLength * pace * delta));
        camera.z = Math.max(-210, Math.min(10, camera.z + moveZ / moveLength * pace * delta));
        walkTime += delta * pace;
      }
      const view = viewMatrix([camera.x, camera.y + (moveLength > 0 ? Math.sin(walkTime * 2.5) * 0.025 : 0), camera.z], forward);
      const projection = perspective(Math.PI / 3, canvas.width / canvas.height, 0.1, 260);
      const uniforms = new Float32Array(24);
      uniforms.set(multiplyMatrices(projection, view), 0);
      uniforms.set([camera.x, camera.y, camera.z, time / 1000], 16);
      uniforms.set([
        reflectionPass ? 1 : 0,
        Math.max(1, Math.floor(canvas.width / 2)),
        Math.max(1, Math.floor(canvas.height / 2)),
        0,
      ], 20);
      device.queue.writeBuffer(reflectionPass ? reflectedUniformBuffer : uniformBuffer, 0, uniforms);
    };

    let reflectionFrame = 0;
    const render = (time) => {
      resizeCanvas();
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      updateUniforms(time, delta, true);
      const encoder = device.createCommandEncoder();
      if (reflectionFrame % 2 === 0) {
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
        reflectionPass.setVertexBuffer(0, reflectionVertexBuffer);
        reflectionPass.draw(reflectionVertices.length / 16);
        reflectionPass.end();
      }
      reflectionFrame += 1;
      updateUniforms(time, 0, false);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.1, g: 0.14, b: 0.12, a: 1 },
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
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(vertices.length / 16);
      pass.end();
      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(render);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    document.addEventListener("keydown", (event) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      keys.add(event.code);
      if (event.code === "Escape" && document.pointerLockElement !== canvas) stopWalking();
    });
    document.addEventListener("keyup", (event) => keys.delete(event.code));
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
      document.body.classList.remove("playing");
      hud.classList.remove("active");
      intro.style.opacity = "1";
      canvas.classList.remove("interactive");
      document.exitPointerLock?.();
    }

    enterButton.addEventListener("click", async () => {
      document.body.classList.add("playing");
      hud.classList.add("active");
      intro.style.opacity = "0";
      canvas.classList.add("interactive");
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
