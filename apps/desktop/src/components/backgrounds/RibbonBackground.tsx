// "Ленты" — Ribbon Glow (Originkit), adapted as an app background: glowing ribbons that swirl
// around the pointer and are dragged by its motion. The shaders are the original's; what was
// for Framer (props, colour parsing, a 1200×800 minimum) is gone, and it follows the app's
// background conventions: full viewport, capped pixel ratio, paused while the window is hidden.
//
// Two passes: the ribbon field at half resolution (84 layered warps per pixel — the expensive
// part), then an upsample + composite over the ground colour with a little dither.

import { useEffect, useRef } from "react";

/** The palette this theme was composed in ("Glacier"). */
const GROUND: [number, number, number] = hex("#0B0A10");
const COLOR_1: [number, number, number] = hex("#2FD3F2");
const COLOR_2: [number, number, number] = hex("#7B61FF");

const MAX_DPR = 1.5;
const SPEED = 1; // 1 = the rate the ribbons shipped at
const SIZE = 1;
const ANGLE = Math.PI; // -180° in the original: the ribbons enter from the lower left
const HOVER = 1;
const REACH_PX = 240;
/** Ambient, not foreground: the ribbons are toned down under the interface. */
const INTENSITY = 0.82;

const LAYERS = 84;
const TWIST = 1.25; // radians of swirl at full hover under the pointer
const DRAG = 0.18; // how far pointer motion drags the plane

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const VERT_SRC = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

// No backticks anywhere in the shader strings: one inside a GLSL comment would end the template literal.
const FIELD_SRC = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uSize;
uniform float uAngle;
uniform vec2 uMouse;
uniform float uOn;
uniform float uReach;
uniform vec2 uVel;
out vec4 o;

const float LAYERS = ${LAYERS.toFixed(1)};
const float TWIST = ${TWIST.toFixed(3)};
const float DRAG = ${DRAG.toFixed(3)};
const float GAIN = 0.62;
const vec2 CENTRE = vec2(-0.62, 0.24);
const float TILT = 0.6;
const float ZOOM = 1.05;
const float THETA = 2.13;
const float SHEAR = 0.963;
const float SHRINK = 0.953;
const vec2 WARP_FREQ = vec2(0.42, 2.4);
const vec2 WARP_AMP = vec2(0.13, 0.027);
const vec2 ASPECT = vec2(2.1, 0.17);
const float OFFSET = 0.36;
const float GLOW = 0.0021;
const float SOFT = 0.0019;
const float FALLOFF = 0.37;
const float PHASE = 12.0;
const float CYCLE = 0.16;
const float HUE_TRAVEL = 2.0;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  vec2 R = uRes;
  vec2 pos = (gl_FragCoord.xy - 0.5 * R) / R.y;

  // The plane swirls around the pointer and is dragged by its motion. Skipped outright at zero
  // weight: mouse + (pos - mouse) does not round-trip, so no hover would still nudge the frame.
  vec2 d = pos - uMouse;
  float w = uOn * exp(-dot(d, d) / (uReach * uReach));
  if (w > 1e-4) pos = uMouse + rot(w * TWIST) * d * (1.0 - 0.3 * min(w, 1.0)) - uVel * min(w, 1.0) * DRAG;

  pos = rot(uAngle) * pos / uSize;
  float t = uTime * 0.49 + PHASE;
  float breath = (-sin(uTime * 0.735) + sin(uTime * 0.49 + 1.0)) * 0.25 + 0.5;
  vec2 u = rot(TILT) * ((pos - CENTRE) * (ZOOM - breath * 0.085));
  mat2 fold = mat2(cos(THETA), sin(THETA), -SHEAR, cos(THETA));

  vec3 col = vec3(0.0);
  for (float i = 1.0; i <= LAYERS; i += 1.0) {
    u.x -= sin(u.y * WARP_FREQ.x + t + i * 0.007) * WARP_AMP.x;
    u.y -= sin(u.x * WARP_FREQ.y - t + i * 0.02) * WARP_AMP.y;
    u = fold * u * SHRINK;
    vec2 q = (u - vec2(OFFSET + breath * 0.1, 0.0)) * ASPECT;
    float g = GLOW / (dot(q, q) + SOFT) * (0.25 + breath * 0.4);
    float r = length(u);
    float k = sin(i * CYCLE + t * 1.2 + r * HUE_TRAVEL) * 0.5 + 0.5;
    col += g * mix(uC1, uC2, k) * (0.62 + 0.5 * k) * exp2(-r * FALLOFF);
  }
  vec3 x = max(col * GAIN, 0.0);
  col = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(0.85, 0.92, 0.98));
  col *= 1.0 - smoothstep(0.5, 1.6, length(pos)) * 0.07;
  o = vec4(col, 1.0);
}
`;

const FINISH_SRC = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uBg;
uniform float uIntensity;
out vec4 o;

float ign(vec2 p, float f) { p += 5.588238 * mod(f, 64.0); return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)); }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 L = max(texture(uField, frag / uRes).rgb, 0.0) * uIntensity;
  // Dark ground: the ribbons are light, screened over it.
  vec3 col = uBg + L * (1.0 - uBg);
  col += (ign(frag, floor(uTime * 24.0)) - 0.5) / 255.0;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function link(gl: WebGL2RenderingContext, frag: string, label: string): WebGLProgram | null {
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(`[ribbon bg] ${label} shader:`, gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = shader(gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn(`[ribbon bg] ${label} link:`, gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function locations(gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[]) {
  const out: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
}

/** The half-resolution field target: half float where the GPU can render to it (no banding in the
 *  smooth falloff), 8-bit otherwise. */
function fieldTarget(gl: WebGL2RenderingContext) {
  const fbo = gl.createFramebuffer();
  let tex: WebGLTexture | null = null;
  let w = 0;
  let h = 0;
  let half = !!gl.getExtension("EXT_color_buffer_float");
  return {
    fbo,
    texture: () => tex,
    width: () => w,
    height: () => h,
    resize(nw: number, nh: number) {
      if (nw === w && nh === h && tex) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (tex) gl.deleteTexture(tex);
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA8, nw, nh, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (ok || !half) break;
        half = false;
      }
      w = nw;
      h = nh;
    },
    dispose() {
      if (tex) gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
    },
  };
}

/** Pointer in CSS px of the window (the background covers the whole viewport). */
function trackPointer() {
  const p = { tx: 0, ty: 0, inside: false };
  const read = (e: PointerEvent) => {
    p.tx = e.clientX;
    p.ty = e.clientY;
    p.inside = true;
  };
  const out = (e: PointerEvent) => {
    if (!e.relatedTarget) p.inside = false;
  };
  window.addEventListener("pointermove", read, { passive: true });
  window.addEventListener("pointerdown", read, { passive: true });
  document.addEventListener("pointerout", out);
  return {
    p,
    dispose() {
      window.removeEventListener("pointermove", read);
      window.removeEventListener("pointerdown", read);
      document.removeEventListener("pointerout", out);
    },
  };
}

export function RibbonBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) {
      console.warn("[ribbon bg] WebGL2 unavailable");
      return; // the static gradient of .app-background stays
    }
    const field = link(gl, FIELD_SRC, "field");
    const finish = link(gl, FINISH_SRC, "finish");
    if (!field || !finish) return;
    const uf = locations(gl, field, ["uRes", "uTime", "uC1", "uC2", "uSize", "uAngle", "uMouse", "uOn", "uReach", "uVel"]);
    const un = locations(gl, finish, ["uField", "uRes", "uTime", "uBg", "uIntensity"]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const target = fieldTarget(gl);
    const pointer = trackPointer();
    const ptr = pointer.p;

    // Eased pointer state, in CSS px (y down) and CSS px per second.
    let mx = 0;
    let my = 0;
    let vx = 0;
    let vy = 0;
    let on = 0;
    let raf = 0;
    let last = -1;
    let clock = 0;
    let paused = false;

    const render = (now: number) => {
      if (paused) return;
      raf = requestAnimationFrame(render);
      const dt = last < 0 ? 0 : clamp((now - last) / 1000, 0, 0.05);
      last = now;
      clock = (clock + dt * SPEED) % 3600;

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const cw = canvas.clientWidth || window.innerWidth;
      const ch = canvas.clientHeight || window.innerHeight;
      const bw = Math.max(1, Math.round(cw * dpr));
      const bh = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      target.resize(Math.max(1, Math.round(bw / 2)), Math.max(1, Math.round(bh / 2)));

      // Presence fades in and out; position is lightly smoothed; velocity is the smoothed
      // derivative of that position.
      const present = ptr.inside ? 1 : 0;
      if (present && on < 0.02) {
        mx = ptr.tx;
        my = ptr.ty;
      }
      on += (present - on) * (1 - Math.exp(-dt * 5));
      const k = 1 - Math.exp(-dt * 16);
      const nx = mx + (ptr.tx - mx) * k;
      const ny = my + (ptr.ty - my) * k;
      if (dt > 0) {
        const kv = 1 - Math.exp(-dt * 8);
        vx += ((nx - mx) / dt - vx) * kv;
        vy += ((ny - my) / dt - vy) * kv;
      }
      mx = nx;
      my = ny;
      const vLen = Math.hypot(vx, vy) / ch;
      const vCap = vLen > 3 ? 3 / vLen : 1;

      // Pass 1: the field, at half resolution.
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width(), target.height());
      gl.useProgram(field);
      gl.uniform2f(uf.uRes, target.width(), target.height());
      gl.uniform1f(uf.uTime, clock);
      gl.uniform3f(uf.uC1, COLOR_1[0], COLOR_1[1], COLOR_1[2]);
      gl.uniform3f(uf.uC2, COLOR_2[0], COLOR_2[1], COLOR_2[2]);
      gl.uniform1f(uf.uSize, SIZE);
      gl.uniform1f(uf.uAngle, ANGLE);
      gl.uniform2f(uf.uMouse, (mx - cw / 2) / ch, (ch / 2 - my) / ch);
      gl.uniform1f(uf.uOn, on * HOVER);
      gl.uniform1f(uf.uReach, REACH_PX / ch);
      gl.uniform2f(uf.uVel, (vx / ch) * vCap, (-vy / ch) * vCap);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 2: upsample and composite.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, bw, bh);
      gl.useProgram(finish);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, target.texture());
      gl.uniform1i(un.uField, 0);
      gl.uniform2f(un.uRes, bw, bh);
      gl.uniform1f(un.uTime, clock);
      gl.uniform3f(un.uBg, GROUND[0], GROUND[1], GROUND[2]);
      gl.uniform1f(un.uIntensity, INTENSITY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(render);

    // Window hidden/minimized: stop painting; the clock carries on from the same moment after.
    const onVisibility = () => {
      if (document.hidden) {
        paused = true;
        cancelAnimationFrame(raf);
      } else if (paused) {
        paused = false;
        last = -1;
        raf = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      paused = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      pointer.dispose();
      target.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteProgram(field);
      gl.deleteProgram(finish);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ background: "#0B0A10" }} />;
}
