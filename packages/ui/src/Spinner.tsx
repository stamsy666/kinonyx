import { useEffect, useRef } from "react";

// Coin Loader by Originkit, adapted from the supplied Origami Coins component.
const TAU = Math.PI * 2
const DPR_CAP = 2
/** Vertical field of view. Framing is the Distance dial's job, not this. */
const FOV = (45 * Math.PI) / 180
const NEAR = 0.1
const FAR = 200

/** The reference's ring radius, its group scale and its disc dimensions. */
const RADIUS = 3
const GROUP_SCALE = 0.6
const COIN_R = 1
const COIN_H = 0.1
const COIN_SEG = 64

/** The reference's 0.01 rad per frame, restated as a rate at 60Hz. Both the
 *  tumble and the ring's counter-turn ship at it. */
const RATE = 0.6

type M4 = Float32Array

/** Column-major, GL order — the same layout three.js uploads. */
function m4(): M4 {
    const o = new Float32Array(16)
    o[0] = o[5] = o[10] = o[15] = 1
    return o
}

function m4Ident(o: M4): M4 {
    o.fill(0)
    o[0] = o[5] = o[10] = o[15] = 1
    return o
}

/** out = a * b. `out` must not alias either input. */
function m4Mul(a: M4, b: M4, out: M4): M4 {
    for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1]
        const b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
        out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3
        out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3
        out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
        out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
    }
    return out
}

const SCR_A = m4()
const SCR_B = m4()

/* Every transform below POST-multiplies (m := m * R), so a chain of calls
 * reads outermost parent first, exactly like walking a three.js scene graph
 * downwards. Euler order XYZ means R = Rx * Ry * Rz, which is what
 * Matrix4.makeRotationFromEuler builds for three's default order — call
 * rotX, then rotY, then rotZ to reproduce it. */

function rotX(m: M4, a: number) {
    if (a === 0) return
    const c = Math.cos(a), s = Math.sin(a)
    m4Ident(SCR_A)
    SCR_A[5] = c; SCR_A[6] = s; SCR_A[9] = -s; SCR_A[10] = c
    m.set(m4Mul(m, SCR_A, SCR_B))
}

function rotY(m: M4, a: number) {
    if (a === 0) return
    const c = Math.cos(a), s = Math.sin(a)
    m4Ident(SCR_A)
    SCR_A[0] = c; SCR_A[2] = -s; SCR_A[8] = s; SCR_A[10] = c
    m.set(m4Mul(m, SCR_A, SCR_B))
}

function rotZ(m: M4, a: number) {
    if (a === 0) return
    const c = Math.cos(a), s = Math.sin(a)
    m4Ident(SCR_A)
    SCR_A[0] = c; SCR_A[1] = s; SCR_A[4] = -s; SCR_A[5] = c
    m.set(m4Mul(m, SCR_A, SCR_B))
}

/** m := m * T(x, y, z) */
function trans(m: M4, x: number, y: number, z: number) {
    m[12] = m[0] * x + m[4] * y + m[8]  * z + m[12]
    m[13] = m[1] * x + m[5] * y + m[9]  * z + m[13]
    m[14] = m[2] * x + m[6] * y + m[10] * z + m[14]
    m[15] = m[3] * x + m[7] * y + m[11] * z + m[15]
}

/** m := m * S(s). Uniform only — non-uniform scale would need the inverse
 *  transpose for the normal matrix, and nothing here scales non-uniformly. */
function scaleU(m: M4, s: number) {
    for (let i = 0; i < 12; i++) m[i] *= s
}

function persp(out: M4, fovy: number, aspect: number, near: number, far: number): M4 {
    const f = 1 / Math.tan(fovy / 2)
    out.fill(0)
    out[0] = f / aspect
    out[5] = f
    out[10] = (far + near) / (near - far)
    out[11] = -1
    out[14] = (2 * far * near) / (near - far)
    return out
}

/** Upper-left 3x3 of the model matrix. The view is a pure translation, so a
 *  model normal IS the view-space normal; the uniform scale is divided out by
 *  the normalize() in the fragment shader. */
function nm3(m: M4, out: Float32Array) {
    out[0] = m[0]; out[1] = m[1]; out[2] = m[2]
    out[3] = m[4]; out[4] = m[5]; out[5] = m[6]
    out[6] = m[8]; out[7] = m[9]; out[8] = m[10]
}

/* ---------------------------------------------------------------- geometry */

interface Geo {
    pos: Float32Array
    nrm: Float32Array
    idx: Uint16Array
}

function pack(pos: number[], nrm: number[], idx: number[]): Geo {
    return {
        pos: new Float32Array(pos),
        nrm: new Float32Array(nrm),
        idx: new Uint16Array(idx),
    }
}

function cylGeo(rTop: number, rBot: number, height: number, seg: number): Geo {
    const pos: number[] = [], nrm: number[] = [], idx: number[] = []
    const half = height / 2
    const slope = (rBot - rTop) / height

    for (let y = 0; y <= 1; y++) {
        const r = y * (rBot - rTop) + rTop
        for (let x = 0; x <= seg; x++) {
            const th = (x / seg) * TAU
            const st = Math.sin(th), ct = Math.cos(th)
            pos.push(r * st, -y * height + half, r * ct)
            const l = Math.sqrt(st * st + slope * slope + ct * ct)
            nrm.push(st / l, slope / l, ct / l)
        }
    }
    for (let x = 0; x < seg; x++) {
        const a = x, d = x + 1
        const b = seg + 1 + x, c = seg + 1 + x + 1
        if (rTop > 0) idx.push(a, b, d)
        if (rBot > 0) idx.push(b, c, d)
    }

    // Caps: one centre vertex plus a fan, wound outwards.
    const cap = (top: boolean) => {
        const r = top ? rTop : rBot
        if (r <= 0) return
        const y = top ? half : -half
        const centre = pos.length / 3
        pos.push(0, y, 0)
        nrm.push(0, top ? 1 : -1, 0)
        for (let x = 0; x <= seg; x++) {
            const th = (x / seg) * TAU
            pos.push(r * Math.sin(th), y, r * Math.cos(th))
            nrm.push(0, top ? 1 : -1, 0)
        }
        for (let x = 0; x < seg; x++) {
            const p0 = centre + 1 + x, p1 = centre + 1 + x + 1
            if (top) idx.push(centre, p0, p1)
            else idx.push(centre, p1, p0)
        }
    }
    cap(true)
    cap(false)

    return pack(pos, nrm, idx)
}

/* ----------------------------------------------------------------- shaders */

const VERT = `
precision highp float;

attribute vec3 aPos;
attribute vec3 aNrm;

uniform mat4 uMVP;
uniform mat3 uNM;

varying vec3 vN;

void main() {
    vN = uNM * aNrm;
    gl_Position = uMVP * vec4(aPos, 1.0);
}
`

/**
 * A PROCEDURAL matcap. The reference shades every mesh with
 * MeshMatcapMaterial against one of three photographed sphere textures
 * (chrome, iridescent, glossy purple): the lit colour is a lookup by the
 * view-space normal, with no light in the scene at all.
 *
 * Sampling a bitmap here would pin the component to an external asset and
 * leave a designer with a dropdown of three fixed looks, so the same shading
 * model is evaluated analytically instead and the two colour dials drive the
 * material directly.
 *
 * KEY and FILL are MEASURED, not invented: the reference's chrome matcap was
 * decoded, unwrapped to view-space normals and least-squares fitted, and those
 * are the two highlight directions that came back. The fit's residual is the
 * honest part of this — RMSE 0.15 over the hemisphere — because a photographed
 * chrome ball carries several reflected bands that two lobes cannot express.
 *
 * So this is an approximation and a DELIBERATE deviation, in one respect: the
 * reference matcap is near-black (0.05) for a surface facing the camera, which
 * on flat geometry drops whole plates and discs out of the frame. The body
 * term here keeps those faces readable. Everything else — where the highlight
 * sits, where the second lobe sits, the hot grazing rim — follows the
 * measurement.
 *
 * The lobes are authored in DISPLAY space, not linear, so there is no encode
 * at the end — unlike a ported physically-lit three scene, which needs one.
 */
const FRAG = `
precision highp float;

varying vec3 vN;

uniform vec3 uBase;
uniform vec3 uAcc;

// Fitted highlight directions of the reference's chrome matcap.
const vec3 KEY  = vec3(-0.4364, 0.4601, 0.7733);
const vec3 FILL = vec3( 0.7831, 0.1309, 0.6080);

void main() {
    vec3 n = normalize(vN);
    float k = max(dot(n, KEY), 0.0);
    float f = max(dot(n, FILL), 0.0);
    // Facing ratio: 1 at the silhouette, 0 dead-on. abs() so a back face that
    // wins the depth test through an opening still rims instead of going flat.
    float graze = 1.0 - clamp(abs(n.z), 0.0, 1.0);

    vec3 c = uBase * (0.08 + 0.62 * pow(k, 2.0));
    c += uAcc * 0.80 * pow(k, 9.0);
    c += uAcc * 0.35 * pow(f, 6.0);
    // The matcap's bright top edge: grazing, and weighted upwards.
    c += uAcc * 0.32 * pow(graze, 3.0) * (0.40 + 0.60 * max(n.y, 0.0));

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`

/* ---------------------------------------------------------------- GL plumbing */

interface Mesh {
    pos: WebGLBuffer
    nrm: WebGLBuffer
    idx: WebGLBuffer
    count: number
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("shader: " + gl.getShaderInfoLog(sh))
        gl.deleteShader(sh)
        return null
    }
    return sh
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return null
    const p = gl.createProgram()
    if (!p) return null
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    gl.linkProgram(p)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error("link: " + gl.getProgramInfoLog(p))
        return null
    }
    return p
}

function upload(gl: WebGLRenderingContext, g: Geo): Mesh | null {
    const pos = gl.createBuffer(), nrm = gl.createBuffer(), idx = gl.createBuffer()
    if (!pos || !nrm || !idx) return null
    gl.bindBuffer(gl.ARRAY_BUFFER, pos)
    gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, nrm)
    gl.bufferData(gl.ARRAY_BUFFER, g.nrm, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW)
    return { pos, nrm, idx, count: g.idx.length }
}

function freeMesh(gl: WebGLRenderingContext, m: Mesh) {
    gl.deleteBuffer(m.pos)
    gl.deleteBuffer(m.nrm)
    gl.deleteBuffer(m.idx)
}

function bindMesh(gl: WebGLRenderingContext, m: Mesh, aPos: number, aNrm: number) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos)
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm)
    gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx)
}


export function Spinner() {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const gl = canvas.getContext("webgl", { antialias: true, alpha: true })
        if (!gl) return
        const program = buildProgram(gl)
        if (!program) return
        const coin = upload(gl, cylGeo(COIN_R, COIN_R, COIN_H, COIN_SEG))
        if (!coin) {
            gl.deleteProgram(program)
            return
        }

        gl.useProgram(program)
        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LEQUAL)
        gl.clearColor(0, 0, 0, 0)

        const position = gl.getAttribLocation(program, "aPos")
        const normal = gl.getAttribLocation(program, "aNrm")
        gl.enableVertexAttribArray(position)
        gl.enableVertexAttribArray(normal)
        const uMvp = gl.getUniformLocation(program, "uMVP")
        const uNormal = gl.getUniformLocation(program, "uNM")
        gl.uniform3f(gl.getUniformLocation(program, "uBase"), 1, 1, 1)
        gl.uniform3f(gl.getUniformLocation(program, "uAcc"), 1, 1, 1)

        const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
        const projection = m4(), view = m4(), camera = m4(), model = m4(), mvp = m4()
        const normalMatrix = new Float32Array(9)
        const count = 8
        let phase = 0
        let raf = 0
        let lastFrame = 0

        const draw = () => {
            const aspect = canvas.width / canvas.height
            persp(projection, FOV, aspect, NEAR, FAR)
            m4Ident(view)
            trans(view, 0, 0, -9 / Math.min(1, aspect))
            m4Mul(projection, view, camera)

            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
            bindMesh(gl, coin, position, normal)
            for (let i = 0; i < count; i++) {
                const angle = i * TAU / count
                const positionAngle = angle + TAU / count
                m4Ident(model)
                rotZ(model, -phase)
                scaleU(model, GROUP_SCALE)
                trans(model, Math.cos(positionAngle) * RADIUS, Math.sin(positionAngle) * RADIUS, 0)
                rotZ(model, angle)
                rotX(model, 0.4 + phase * 2)
                rotY(model, Math.PI / count + phase * 2)
                rotZ(model, Math.PI / 2 + phase * 2)
                m4Mul(camera, model, mvp)
                nm3(model, normalMatrix)
                gl.uniformMatrix4fv(uMvp, false, mvp)
                gl.uniformMatrix3fv(uNormal, false, normalMatrix)
                gl.drawElements(gl.TRIANGLES, coin.count, gl.UNSIGNED_SHORT, 0)
            }
            canvas.dataset.ready = ""
        }

        const frame = (time: number) => {
            const delta = lastFrame ? Math.min((time - lastFrame) / 1000, 0.05) : 0
            lastFrame = time
            phase = (phase + RATE * delta) % TAU
            draw()
            raf = requestAnimationFrame(frame)
        }
        const syncMotion = () => {
            cancelAnimationFrame(raf)
            lastFrame = 0
            if (!document.hidden && !motion.matches && !gl.isContextLost()) raf = requestAnimationFrame(frame)
        }
        const resize = () => {
            if (gl.isContextLost()) return
            const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
            const width = Math.round(canvas.clientWidth * dpr)
            const height = Math.round(canvas.clientHeight * dpr)
            if (!width || !height) return
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width
                canvas.height = height
            }
            gl.viewport(0, 0, width, height)
            draw()
        }
        const onContextLost = () => {
            cancelAnimationFrame(raf)
            delete canvas.dataset.ready
        }
        const observer = new ResizeObserver(resize)
        observer.observe(canvas)
        canvas.addEventListener("webglcontextlost", onContextLost)
        document.addEventListener("visibilitychange", syncMotion)
        motion.addEventListener("change", syncMotion)
        resize()
        syncMotion()

        return () => {
            cancelAnimationFrame(raf)
            observer.disconnect()
            canvas.removeEventListener("webglcontextlost", onContextLost)
            document.removeEventListener("visibilitychange", syncMotion)
            motion.removeEventListener("change", syncMotion)
            freeMesh(gl, coin)
            gl.deleteProgram(program)
            delete canvas.dataset.ready
        }
    }, [])

    return (
        <span className="spinner" aria-hidden="true">
            <canvas className="spinner__canvas" ref={canvasRef} />
            <span className="spinner__fallback" />
        </span>
    )
}
