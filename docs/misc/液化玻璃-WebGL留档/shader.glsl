// 历史留档 · 2026-10-31
// 液态玻璃 WebGL 路线终版片元着色器（用户拍板放弃该路线，仅作追溯）
// 来源：.workbuddy/liquid-css-vs-webgl.html（临时实验室，未入库）
// 参数与 uniform 映射见同目录 README.md

precision highp float;
varying vec2 vUv;
uniform sampler2D uSharp;
uniform sampler2D uBlur;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform vec2 uUvOffset;
uniform vec2 uUvScale;
uniform float uRefract;
uniform float uDisp;
uniform float uBlurMix;
uniform float uCenterBlur;
uniform float uInnerDark;
uniform float uGlare;
uniform float uSpec;
uniform float uTint;
uniform float uLightX;
uniform float uLightY;
uniform float uSquircle;

float sdSquircle(vec2 p, vec2 size, float n) {
  vec2 d = abs(p) / size;
  float f = pow(pow(d.x, n) + pow(d.y, n), 1.0 / n);
  return (f - 1.0) * min(size.x, size.y);
}

vec2 toBgUv(vec2 localUv) { return uUvOffset + localUv * uUvScale; }

void main() {
  vec2 frag = vUv * uRes;
  vec2 p = frag - uCenter;
  float d = sdSquircle(p, uHalf, uSquircle);
  vec3 bg = texture2D(uSharp, toBgUv(vUv)).rgb;

  // 外部软阴影
  if (d > 0.0) {
    float shadow = exp(-d / 46.0) * 0.42;
    gl_FragColor = vec4(bg * (1.0 - shadow), 1.0);
    return;
  }

  float edgeBand = 96.0;
  float edge = clamp(-d / edgeBand, 0.0, 1.0);

  // SDF 梯度 → 2D 法线
  float e = 1.0;
  float dx = sdSquircle(p + vec2(e, 0.0), uHalf, uSquircle) - sdSquircle(p - vec2(e, 0.0), uHalf, uSquircle);
  float dy = sdSquircle(p + vec2(0.0, e), uHalf, uSquircle) - sdSquircle(p - vec2(0.0, e), uHalf, uSquircle);
  vec2 n2 = normalize(vec2(dx, dy) + vec2(0.0001));

  // 斜面法线：边缘 z 下降，内部完全趋平（nz 必须到 1，否则中心会出现假折射）
  float bevel = smoothstep(0.0, 1.0, -d / 56.0);
  float nz = mix(0.35, 1.0, bevel);
  vec3 N = normalize(vec3(n2 * (1.0 - nz) * 1.8, nz));

  // Fresnel（F0 = 0.04）
  vec3 V = vec3(0.0, 0.0, 1.0);
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float F0 = 0.04;
  float fres = F0 + (1.0 - F0) * pow(1.0 - cosT, 5.0);

  // 中心更清晰、边缘更模糊：玻璃中部近似平板，模糊集中在弯折带
  float localBlur = uBlurMix * mix(uCenterBlur, 1.0, edge);
  vec3 sharpS = texture2D(uSharp, toBgUv(vUv)).rgb;
  vec3 blurS = texture2D(uBlur, toBgUv(vUv)).rgb;
  vec3 base = mix(sharpS, blurS, localBlur);

  // Snell 折射：三个 IOR 产生色散
  vec3 I = vec3(0.0, 0.0, -1.0);
  vec3 dirR = refract(I, N, 1.0 / 1.505);
  vec3 dirG = refract(I, N, 1.0 / 1.520);
  vec3 dirB = refract(I, N, 1.0 / 1.535);
  vec2 offR = dirR.xy * uRefract / uRes;
  vec2 offG = dirG.xy * uRefract / uRes;
  vec2 offB = dirB.xy * uRefract / uRes;
  // 色散同样只在弯折带发生，平直中心不能偏移，否则整块玻璃会出现 RGB 重影
  float disp = uDisp / uRes.x * (1.0 - nz);

  vec3 refr;
  refr.r = mix(texture2D(uSharp, toBgUv(vUv + offR + n2 * disp)).r, texture2D(uBlur, toBgUv(vUv + offR + n2 * disp)).r, localBlur);
  refr.g = mix(texture2D(uSharp, toBgUv(vUv + offG)).g, texture2D(uBlur, toBgUv(vUv + offG)).g, localBlur);
  refr.b = mix(texture2D(uSharp, toBgUv(vUv + offB - n2 * disp)).b, texture2D(uBlur, toBgUv(vUv + offB - n2 * disp)).b, localBlur);
  refr = mix(refr, base, 0.28);

  // 饱和度提升 + 烟灰染色
  vec3 gray = vec3(dot(refr, vec3(0.299, 0.587, 0.114)));
  refr = mix(gray, refr, 1.45);
  vec3 col = mix(refr, vec3(0.36, 0.39, 0.46), uTint);

  // 方向性边缘高光：一圈细亮线 + 一圈更宽的柔光，参考图里是两层内阴影叠出来的
  vec2 light2D = normalize(vec2((uLightX - 0.5) * 2.2, (0.5 - uLightY) * 2.2));
  float toward = clamp(dot(n2, light2D), 0.0, 1.0);
  float away = clamp(dot(n2, -light2D), 0.0, 1.0);
  float rim = exp(-pow(d / 1.6, 2.0)) * 0.50 + exp(-pow(d / 8.0, 2.0)) * 0.16;
  col += vec3(rim) * (0.5 + 0.5 * toward - 0.4 * away);

  // 焦散亮带
  float caustic = pow(1.0 - edge, 6.0) * 0.18;
  col += vec3(caustic);

  // 内圈暗线：玻璃厚度导致的暗焦散，上缘更强
  float innerRing = exp(-pow(((-d) - 9.0) / 6.0, 2.0));
  float upper = 0.45 + 0.55 * clamp(n2.y, 0.0, 1.0);
  col *= 1.0 - innerRing * uInnerDark * upper;

  // 对角眩光：参考 45° 渐变白角，集中在两个对角
  float diag = (p.x - p.y) / (uHalf.x + uHalf.y);
  float corner = smoothstep(0.55, 1.0, abs(diag));
  col += vec3(corner * pow(edge, 1.6) * uGlare);

  // 镜面光（Blinn-Phong）
  vec3 L = normalize(vec3(light2D, 1.2));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 90.0) * uSpec * pow(1.0 - edge, 1.4);
  col += vec3(spec) * 0.6;

  // Fresnel 反射
  col = mix(col, vec3(0.80, 0.85, 0.95), fres * 0.20);

  // 轻微对比增强，贴近参考里的 contrast()
  col = (col - 0.5) * 1.05 + 0.5;

  // 颗粒
  float grain = fract(sin(dot(frag, vec2(127.1, 311.7))) * 43758.5453) - 0.5;
  col += grain * 0.02;

  gl_FragColor = vec4(col, 1.0);
}
