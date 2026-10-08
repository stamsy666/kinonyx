import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * The "Voice Powered Orb" (WebGL, 21st.dev) for the voice-search window. The fragment shader is
 * the original's, untouched; what changed is how it is driven and fed:
 *  - plain WebGL1 with a fullscreen triangle instead of the `ogl` package (not a dependency here);
 *  - no microphone of its own — the recorder (data/voiceInput.ts) already owns the stream, so the
 *    voice level arrives through `level` (0..1) and is eased per frame for smooth motion;
 *  - `mode`: while "listening" the orb follows the voice; while "thinking" it swirls by itself.
 */

const VERT = `
  precision highp float;
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAG = `
  precision highp float;

  uniform float iTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float hover;
  uniform float rot;
  uniform float hoverIntensity;
  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) {
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    float i = dot(c, vec3(0.596, -0.274, -0.322));
    float q = dot(c, vec3(0.211, -0.523, 0.312));
    return vec3(y, i, q);
  }

  vec3 yiq2rgb(vec3 c) {
    float r = c.x + 0.956 * c.y + 0.621 * c.z;
    float g = c.x - 0.272 * c.y - 0.647 * c.z;
    float b = c.x - 1.106 * c.y + 1.703 * c.z;
    return vec3(r, g, b);
  }

  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = hueDeg * 3.14159265 / 180.0;
    vec3 yiq = rgb2yiq(color);
    float cosA = cos(hueRad);
    float sinA = sin(hueRad);
    float i = yiq.y * cosA - yiq.z * sinA;
    float q = yiq.y * sinA + yiq.z * cosA;
    yiq.y = i;
    yiq.z = q;
    return yiq2rgb(yiq);
  }

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(
      p3.x + p3.y,
      p3.x + p3.z,
      p3.y + p3.z
    ) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(
      dot(d0, d0),
      dot(d1, d1),
      dot(d2, d2),
      dot(d3, d3)
    ), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  // The original hard-codes purple / cyan / deep blue here; they are uniforms now so the orb
  // can take the interface theme's colours.
  uniform vec3 baseColor1;
  uniform vec3 baseColor2;
  uniform vec3 baseColor3;
  const float innerRadius = 0.6;
  const float noiseScale = 0.65;

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }

  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3 color1 = adjustHue(baseColor1, hue);
    vec3 color2 = adjustHue(baseColor2, hue);
    vec3 color3 = adjustHue(baseColor3, hue);

    float ang = atan(uv.y, uv.x);
    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;

    float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0, 10.0, d0);
    v0 *= smoothstep(r0 * 1.05, r0, len);
    float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

    float a = iTime * -1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = light2(1.5, 5.0, d);
    v1 *= light1(1.0, 50.0, d0);

    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col = mix(color1, color2, cl);
    col = mix(color3, col, v0);
    col = (col + v1) * v2 * v3;
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  vec4 mainImage(vec2 fragCoord) {
    vec2 center = iResolution.xy * 0.5;
    float size = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord - center) / size * 2.0;

    float angle = rot;
    float s = sin(angle);
    float c = cos(angle);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
    uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

    return draw(uv);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution.xy;
    vec4 col = mainImage(fragCoord);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`;

export type OrbMode = "idle" | "listening" | "thinking";

type Rgb = [number, number, number];

/** `#rrggbb` → 0..1 floats; null if it isn't a plain hex colour. */
function parseHex(value: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The orb's three colours from the current theme's `--accent` / `--accent-deep`. */
function themeOrbColors(): [Rgb, Rgb, Rgb] {
  const css = getComputedStyle(document.documentElement);
  const accent = parseHex(css.getPropertyValue("--accent")) ?? [0.61, 0.26, 1.0];
  const deep = parseHex(css.getPropertyValue("--accent-deep")) ?? [0.06, 0.08, 0.6];
  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return [
    accent,
    mix(accent, [1, 1, 1], 0.45), // lighter tint — the original's cyan plays this part
    [deep[0] * 0.6, deep[1] * 0.6, deep[2] * 0.6], // dark core
  ];
}

interface Props {
  /** Current voice level 0..1, written by the recorder (a ref, so no re-render per audio chunk). */
  level: MutableRefObject<number>;
  mode: OrbMode;
  /** Colour shift of the palette, degrees. */
  hue?: number;
}

const MAX_ROTATION_SPEED = 1.2;
const MAX_HOVER_INTENSITY = 0.8;
const BASE_ROTATION_SPEED = 0.3;

export function VoiceOrb({ level, mode, hue = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hueRef = useRef(hue);
  hueRef.current = hue;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    container.appendChild(canvas);
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) {
      container.removeChild(canvas);
      return;
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn("[orb] shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const vert = compile(gl.VERTEX_SHADER, VERT);
    const frag = compile(gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.bindAttribLocation(program, 0, "position");
    gl.bindAttribLocation(program, 1, "uv");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[orb] link:", gl.getProgramInfoLog(program));
      container.removeChild(canvas);
      return;
    }
    gl.useProgram(program);

    // Fullscreen triangle with uvs, like ogl's Triangle.
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uTime = u("iTime");
    const uRes = u("iResolution");
    const uHue = u("hue");
    const uHover = u("hover");
    const uRot = u("rot");
    const uHoverIntensity = u("hoverIntensity");

    // Palette from the active theme: accent, a lighter tint of it, and a deep dark tone.
    const [c1, c2, c3] = themeOrbColors();
    gl.uniform3f(u("baseColor1"), ...c1);
    gl.uniform3f(u("baseColor2"), ...c2);
    gl.uniform3f(u("baseColor3"), ...c3);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(container.clientWidth * dpr));
      const h = Math.max(1, Math.floor(container.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform3f(uRes, w, h, w / h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let raf = 0;
    let last = performance.now();
    let rot = 0;
    let voice = 0;
    let paused = false;
    const t0 = last;

    const draw = (now: number) => {
      if (paused) return;
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;

      // What the orb "hears": the live voice level while listening; a gentle self-driven swell
      // while the speech is being recognised; calm otherwise.
      const m = modeRef.current;
      const target = m === "listening" ? level.current : m === "thinking" ? 0.4 + 0.15 * Math.sin(t * 3) : 0;
      voice += (target - voice) * Math.min(1, dt * 12);

      if (voice > 0.05) rot += dt * (BASE_ROTATION_SPEED + voice * MAX_ROTATION_SPEED * 2.0);

      gl.uniform1f(uTime, t);
      gl.uniform1f(uHue, hueRef.current);
      gl.uniform1f(uHover, Math.min(voice * 2.0, 1.0));
      gl.uniform1f(uHoverIntensity, Math.min(voice * MAX_HOVER_INTENSITY * 0.8, MAX_HOVER_INTENSITY));
      gl.uniform1f(uRot, rot);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.hidden) {
        paused = true;
        cancelAnimationFrame(raf);
      } else if (paused) {
        paused = false;
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      observer.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      if (container.contains(canvas)) container.removeChild(canvas);
    };
    // The shader is built once; mode/hue are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="voice-orb" aria-hidden="true" />;
}
