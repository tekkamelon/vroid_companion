// VRoid Companion — レンダラープロセス
// three.js + @pixiv/three-vrm はnpmからbundleせず、
// 開発中はnode_modules直参照を使う。
// (Electronはfile://でnode_modulesにアクセス可能)

import * as THREE from '../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../../node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';

// DOM 要素への参照を取得する
const canvas = document.getElementById('vrm-canvas');
const canvasArea = document.getElementById('canvas-area');
const log    = document.getElementById('log');
const input  = document.getElementById('msg-input');
const btn    = document.getElementById('send-btn');
const bootNote = document.getElementById('boot-note');

// ステータス表示用の要素を動的に作成して body に追加する
const status = document.createElement('div');
status.id = 'status';
status.textContent = 'starting...';
document.body.appendChild(status);

// 画面上部のステータスと起動ノートにテキストを反映する
function report(text) {
    status.textContent = text;
    if (bootNote) bootNote.textContent = text;
}

// グローバルな JavaScript エラーを捕捉して表示する
window.addEventListener('error', (event) => {
    report(`JS error: ${event.message}`);
    console.error(event.error ?? event.message);
});

// 未ハンドルの Promise 拒否を捕捉して表示する
window.addEventListener('unhandledrejection', (event) => {
    report(`Promise rejected: ${event.reason?.message ?? event.reason}`);
    console.error(event.reason);
});

// Content Security Policy 違反を検出してログに記録する
window.addEventListener('securitypolicyviolation', (event) => {
    appendLog('Debug', `CSP violation: ${event.violatedDirective} blocked=${event.blockedURI}`);
    console.warn('[CSP]', event.violatedDirective, event.blockedURI);
});

// ---- Three.js セットアップ ----

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setClearColor(0x1a1a2e, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
report(`WebGL ${renderer.capabilities.isWebGL2 ? '2' : '1'} ready`);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20);
camera.position.set(0, 1.4, 3);

const hemiLight = new THREE.HemisphereLight(0xc8d9ff, 0x223355, 1.2);
scene.add(hemiLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(1.5, 3.0, 2.0);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.6);
fillLight.position.set(-2.0, 1.0, 1.0);
scene.add(fillLight);

scene.background = new THREE.Color(0x1a1a2e);
scene.add(new THREE.GridHelper(10, 10, 0x6ba4ff, 0x2e3658));

let currentVrm = null;
const cameraTarget = new THREE.Vector3();
let framing = null;
let idleMotion = null;

function resizeRenderer() {
    const width = canvasArea?.clientWidth ?? canvas.clientWidth;
    const height = canvasArea?.clientHeight ?? canvas.clientHeight;
    if (!width || !height) return;

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height, true);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCurrentVrm();
    report(`renderer ${width}x${height}`);
}

const resizeObserver = new ResizeObserver(() => {
    resizeRenderer();
    frameCurrentVrm();
});
if (canvasArea) resizeObserver.observe(canvasArea);

function frameCurrentVrm() {
    if (!currentVrm || !framing) return;

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const topY = framing.sizeY / 2;
    const fullHeight = framing.sizeY;

    const focusTop = topY - fullHeight * 0.01;
    const focusBottom = topY - fullHeight * 0.76;
    const focusHeight = focusTop - focusBottom;
    const focusCenterY = (focusTop + focusBottom) * 0.5;

    const targetFillY = 0.78;
    const targetFillX = 0.62;
    const torsoWidth = fullHeight * 0.64;
    const distanceByHeight = (focusHeight * 0.5) / (Math.tan(vFov / 2) * targetFillY);
    const distanceByWidth = (torsoWidth * 0.5) / (Math.tan(hFov / 2) * targetFillX);
    const distance = Math.max(distanceByHeight, distanceByWidth) * 1.01;

    camera.position.set(0, focusCenterY + fullHeight * 0.09, distance);
    camera.near = Math.max(distance / 100, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    cameraTarget.set(0, focusCenterY + fullHeight * 0.07, 0);
    camera.lookAt(cameraTarget);
}

// ---- VRMロード ----

function loadVrm(url) {
    const loadingManager = new THREE.LoadingManager();
    loadingManager.onStart = (loaded, total, resourceUrl) => {
        appendLog('Debug', `loading start ${loaded}/${total} ${resourceUrl ?? ''}`);
    };
    loadingManager.onProgress = (resourceUrl, loaded, total) => {
        appendLog('Debug', `loading progress ${loaded}/${total} ${resourceUrl ?? ''}`);
    };
    loadingManager.onLoad = () => {
        appendLog('Debug', 'loading manager complete');
    };
    loadingManager.onError = (resourceUrl) => {
        appendLog('Debug', `loading error ${resourceUrl ?? '(unknown)'}`);
    };

    const loader = new GLTFLoader(loadingManager);
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
        url,
        (gltf) => {
            if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
            idleMotion = null;
            currentVrm = gltf.userData.vrm;

            const summarizeMaterials = (root) => {
                let textured = 0;
                let total = 0;
                const debug = [];
                root.traverse((object) => {
                    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
                    total += materials.length;
                    textured += materials.filter((material) => material?.map || material?.emissiveMap || material?.normalMap || material?.metalnessMap || material?.roughnessMap).length;
                    for (const material of materials) {
                        debug.push(`${material?.name ?? '(unnamed)'}|${material?.type ?? '(no-type)'}|map=${Boolean(material?.map)}|emi=${Boolean(material?.emissiveMap)}|nrm=${Boolean(material?.normalMap)}|alpha=${Boolean(material?.alphaMap)}`);
                    }
                });
                return { total, textured, debug };
            };

            const beforeOptimize = summarizeMaterials(currentVrm.scene);
            VRMUtils.removeUnnecessaryVertices(currentVrm.scene);
            VRMUtils.combineSkeletons(currentVrm.scene);
            const afterOptimize = summarizeMaterials(currentVrm.scene);

            currentVrm.scene.rotation.y = Math.PI;

            const box = new THREE.Box3().setFromObject(currentVrm.scene);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
            framing = {
                sizeX: size.x,
                sizeY: size.y,
                sizeZ: size.z,
                centerX: center.x,
                centerY: center.y,
                centerZ: center.z,
            };

            currentVrm.scene.position.set(-framing.centerX, -framing.centerY, -framing.centerZ);

            appendLog('Debug', `before optimize materials=${beforeOptimize.total} textured=${beforeOptimize.textured}`);
            appendLog('Debug', beforeOptimize.debug.slice(0, 12).join(' ; '));
            appendLog('Debug', `after optimize materials=${afterOptimize.total} textured=${afterOptimize.textured}`);
            appendLog('Debug', afterOptimize.debug.slice(0, 12).join(' ; '));

            scene.add(currentVrm.scene);
            setupIdleMotion();
            frameCurrentVrm();
            appendLog('System', 'VRM loaded');
            report('VRM loaded');
        },
        undefined,
        (error) => {
            console.error('[VRM] failed to load', error);
            appendLog('System', `VRM load failed: ${error?.message ?? error}`);
            report(`VRM load failed`);
        },
    );
}

// ---- レンダーループ ----

// 待機時のモーション
const clock = new THREE.Clock();
const idleEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const idleQuat = new THREE.Quaternion();

function idleRotation(x = 0, y = 0, z = 0) {
    idleEuler.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
    return new THREE.Quaternion().setFromEuler(idleEuler).toArray();
}

const IDLE_FINGER_POSE = {
    leftThumbMetacarpal: { rotation: idleRotation(4, -10, 10) },
    leftThumbProximal: { rotation: idleRotation(4, -4, 12) },
    leftThumbDistal: { rotation: idleRotation(2, 0, 8) },
    leftIndexProximal: { rotation: idleRotation(3, 0, 18) },
    leftIndexIntermediate: { rotation: idleRotation(2, 0, 20) },
    leftIndexDistal: { rotation: idleRotation(1, 0, 12) },
    leftMiddleProximal: { rotation: idleRotation(3, 0, 22) },
    leftMiddleIntermediate: { rotation: idleRotation(2, 0, 24) },
    leftMiddleDistal: { rotation: idleRotation(1, 0, 14) },
    leftRingProximal: { rotation: idleRotation(3, 0, 25) },
    leftRingIntermediate: { rotation: idleRotation(2, 0, 27) },
    leftRingDistal: { rotation: idleRotation(1, 0, 16) },
    leftLittleProximal: { rotation: idleRotation(3, 0, 28) },
    leftLittleIntermediate: { rotation: idleRotation(2, 0, 30) },
    leftLittleDistal: { rotation: idleRotation(1, 0, 17) },
    rightThumbMetacarpal: { rotation: idleRotation(4, 10, -10) },
    rightThumbProximal: { rotation: idleRotation(4, 4, -12) },
    rightThumbDistal: { rotation: idleRotation(2, 0, -8) },
    rightIndexProximal: { rotation: idleRotation(3, 0, -18) },
    rightIndexIntermediate: { rotation: idleRotation(2, 0, -20) },
    rightIndexDistal: { rotation: idleRotation(1, 0, -12) },
    rightMiddleProximal: { rotation: idleRotation(3, 0, -22) },
    rightMiddleIntermediate: { rotation: idleRotation(2, 0, -24) },
    rightMiddleDistal: { rotation: idleRotation(1, 0, -14) },
    rightRingProximal: { rotation: idleRotation(3, 0, -25) },
    rightRingIntermediate: { rotation: idleRotation(2, 0, -27) },
    rightRingDistal: { rotation: idleRotation(1, 0, -16) },
    rightLittleProximal: { rotation: idleRotation(3, 0, -28) },
    rightLittleIntermediate: { rotation: idleRotation(2, 0, -30) },
    rightLittleDistal: { rotation: idleRotation(1, 0, -17) },
};

const IDLE_BONE_POSE = {
    spine: { x: THREE.MathUtils.degToRad(2) },
    chest: { x: THREE.MathUtils.degToRad(-3) },
    neck: { x: THREE.MathUtils.degToRad(2) },
    head: { x: THREE.MathUtils.degToRad(-2) },
    leftShoulder: { z: THREE.MathUtils.degToRad(-4) },
    rightShoulder: { z: THREE.MathUtils.degToRad(4) },
    leftUpperArm: { x: THREE.MathUtils.degToRad(3), y: THREE.MathUtils.degToRad(4), z: THREE.MathUtils.degToRad(64) },
    rightUpperArm: { x: THREE.MathUtils.degToRad(3), y: THREE.MathUtils.degToRad(-4), z: THREE.MathUtils.degToRad(-64) },
    leftLowerArm: { y: THREE.MathUtils.degToRad(8), z: THREE.MathUtils.degToRad(10) },
    rightLowerArm: { y: THREE.MathUtils.degToRad(-8), z: THREE.MathUtils.degToRad(-10) },
    leftHand: { x: THREE.MathUtils.degToRad(2), z: THREE.MathUtils.degToRad(4) },
    rightHand: { x: THREE.MathUtils.degToRad(2), z: THREE.MathUtils.degToRad(-4) },
};

function getHumanoidBone(name) {
    const humanoid = currentVrm?.humanoid;
    return humanoid?.getNormalizedBoneNode?.(name) ?? humanoid?.getRawBoneNode?.(name) ?? null;
}

function setupIdleMotion() {
    const bones = new Map();
    Object.keys(IDLE_BONE_POSE).forEach((name) => {
        const node = getHumanoidBone(name);
        if (node) bones.set(name, { node, rest: node.quaternion.clone() });
    });

    idleMotion = {
        elapsed: 0,
        baseSceneY: currentVrm?.scene?.position.y ?? 0,
        bones,
    };
}

function applyIdleBonePose(name, motion = {}) {
    const bone = idleMotion?.bones.get(name);
    if (!bone) return;

    const base = IDLE_BONE_POSE[name] ?? {};
    idleEuler.set(
        (base.x ?? 0) + (motion.x ?? 0),
        (base.y ?? 0) + (motion.y ?? 0),
        (base.z ?? 0) + (motion.z ?? 0),
    );
    idleQuat.setFromEuler(idleEuler);
    bone.node.quaternion.copy(bone.rest).multiply(idleQuat);
}

function updateIdleMotion(delta) {
    if (!idleMotion || !currentVrm) return;

    idleMotion.elapsed += delta;
    const t = idleMotion.elapsed;
    const breath = Math.sin(t * Math.PI * 2 * 0.28);
    const slowShift = Math.sin(t * Math.PI * 2 * 0.12);
    const headDrift = Math.sin(t * Math.PI * 2 * 0.16 + 0.8);
    const armSway = Math.sin(t * Math.PI * 2 * 0.2 + 1.4);

    currentVrm.scene.position.y = idleMotion.baseSceneY + breath * 0.008;
    currentVrm.humanoid?.setNormalizedPose?.(IDLE_FINGER_POSE);

    applyIdleBonePose('spine', { x: breath * 0.012, z: slowShift * 0.01 });
    applyIdleBonePose('chest', { x: breath * -0.018, z: slowShift * 0.006 });
    applyIdleBonePose('neck', { x: breath * 0.006, y: headDrift * 0.012 });
    applyIdleBonePose('head', { x: breath * -0.008, y: headDrift * 0.018, z: slowShift * 0.006 });
    applyIdleBonePose('leftShoulder', { z: armSway * 0.008 });
    applyIdleBonePose('rightShoulder', { z: -armSway * 0.008 });
    applyIdleBonePose('leftUpperArm', { x: breath * 0.008, z: armSway * 0.012 });
    applyIdleBonePose('rightUpperArm', { x: breath * 0.008, z: -armSway * 0.012 });
    applyIdleBonePose('leftLowerArm', { z: armSway * 0.01 });
    applyIdleBonePose('rightLowerArm', { z: -armSway * 0.01 });
    applyIdleBonePose('leftHand', { z: armSway * 0.012 });
    applyIdleBonePose('rightHand', { z: -armSway * 0.012 });
}

function animate() {
    requestAnimationFrame(animate);
    resizeRenderer();
    const delta = clock.getDelta();

    if (currentVrm) {
        updateIdleMotion(delta);
        updateExpressionFade(delta);
        currentVrm.update(delta);
    }
    renderer.render(scene, camera);
}
animate();

// ---- 感情タグパース + 表情制御 (Phase 3) ----

const PRESET_EXPRESSIONS = ['neutral','happy','sad','angry','surprised','relaxed'];
const EXPRESSION_HOLD_SECONDS = 2.0;
const EXPRESSION_FADE_SECONDS = 1.5;
let activeExpression = null;

function parseAgentResponse(raw) {
    if (typeof raw !== 'string') return { text: String(raw), emotion: null };
    const lines = raw.trim().split('\n');
    const last  = lines[lines.length - 1].trim();
    let emotion = null;
    let text    = raw.trim();
    try {
        const parsed = JSON.parse(last);
        if (parsed && PRESET_EXPRESSIONS.includes(parsed.emotion)) {
            const intensity = Number(parsed.intensity ?? 1.0);
            emotion = {
                name: parsed.emotion,
                intensity: Number.isFinite(intensity) ? THREE.MathUtils.clamp(intensity, 0, 1) : 1.0,
            };
            text = lines.slice(0, -1).join('\n').trim();
        }
    } catch (_) { /* タグなし */ }
    return { text, emotion };
}

function setExpression(name, intensity) {
    if (!currentVrm?.expressionManager) return;
    const value = THREE.MathUtils.clamp(Number(intensity ?? 1.0), 0, 1);

    if (name === 'neutral' || !PRESET_EXPRESSIONS.includes(name) || value <= 0) {
        activeExpression = null;
        resetExpressions();
        return;
    }

    activeExpression = { name, intensity: value, elapsed: 0 };
    applyExpression(name, value);
}

function resetExpressions() {
    if (!currentVrm?.expressionManager) return;
    PRESET_EXPRESSIONS.forEach(e => currentVrm.expressionManager.setValue(e, 0));
}

function applyExpression(name, intensity) {
    resetExpressions();
    currentVrm.expressionManager.setValue(name, intensity);
}

function updateExpressionFade(delta) {
    if (!activeExpression || !currentVrm?.expressionManager) return;

    activeExpression.elapsed += delta;
    if (activeExpression.elapsed <= EXPRESSION_HOLD_SECONDS) return;

    const fadeElapsed = activeExpression.elapsed - EXPRESSION_HOLD_SECONDS;
    const fadeProgress = THREE.MathUtils.clamp(fadeElapsed / EXPRESSION_FADE_SECONDS, 0, 1);
    const value = activeExpression.intensity * (1 - fadeProgress);

    if (value <= 0.001) {
        activeExpression = null;
        resetExpressions();
        return;
    }

    applyExpression(activeExpression.name, value);
}

async function playTts(text) {
    if (!text) return;
    try {
        const result = await window.companion.synthesizeSpeech(text);
        if (!result || result.disabled || !result.audioBase64) return;

        const bytes = Uint8Array.from(atob(result.audioBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: result.mimeType ?? 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
    } catch (err) {
        console.warn('[TTS] playback skipped:', err?.message ?? err);
    }
}

// ---- デバッグ用: DevTools Console からテストできるように公開 ----
window.parseAgentResponse = parseAgentResponse;
window.setExpression = setExpression;

// ---- チャットUI ----

// 会話ログにメッセージを追加して自動スクロールする
function appendLog(who, text) {
    const row = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (who === 'You') {
        row.className = 'msg-row user';
        bubble.textContent = text;
    } else if (who === 'AI') {
        row.className = 'msg-row ai';
        bubble.textContent = text;
    } else {
        row.className = 'msg-row system';
        bubble.textContent = `[${who}] ${text}`;
    }

    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return bubble;
}

// 最後のAIメッセージに追記する (Phase 4 ストリーミング用)
function appendToLastMessage(text) {
    const entries = log.querySelectorAll('.msg-row.ai .msg-bubble');
    if (entries.length === 0) {
        appendLog('AI', text);
        return;
    }
    const last = entries[entries.length - 1];
    last.textContent += text;
    log.scrollTop = log.scrollHeight;
}

// 入力されたメッセージを送信して AI 応答を待つ
async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendLog('You', text);

    // ストリーミング表示用に空のAIメッセージを事前追加
    appendLog('AI', '');

    try {
        const rawText = await window.companion.sendMessage(text);
        console.log('[app] response length:', rawText?.length ?? 0);
        const parsed = parseAgentResponse(rawText);
        // ストリーミング完了後、感情タグを除いた最終テキストで上書き
        const entries = log.querySelectorAll('.msg-row.ai .msg-bubble');
        if (entries.length > 0) {
            const last = entries[entries.length - 1];
            last.textContent = parsed.text;
        } else if (parsed.text) {
            appendLog('AI', parsed.text);
        }
        if (parsed.emotion) {
            setExpression(parsed.emotion.name, parsed.emotion.intensity);
            console.log('[app] emotion:', parsed.emotion.name, parsed.emotion.intensity);
        }
        await playTts(parsed.text);
    } catch (err) {
        console.error('[app] sendMessage error:', err);
        appendLog('AI', 'Error: ' + err.message);
    }
}

// 送信ボタンのクリックイベントを設定する
btn.addEventListener('click', sendMessage);

// Enter キーでメッセージを送信できるようにする
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

// Phase 4: ストリーミングチャンクを受信してリアルタイム表示
window.companion.onChunk((text) => {
    appendToLastMessage(text);
});

// Phase 2 完了通知 (完全な応答テキストが届いた場合のフォールバック)
window.companion.onResponse((data) => {
    if (typeof data === 'string') {
        appendToLastMessage(data);
    } else if (data?.text) {
        appendToLastMessage(data.text);
        if (data?.emotion) setExpression(data.emotion, data.intensity ?? 1.0);
    }
});

// ---- 初期VRMロード (モデルがあれば) ----
loadVrm(new URL('../assets/models/model.vrm', import.meta.url).href);
