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

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    resizeRenderer();
    const delta = clock.getDelta();

    if (currentVrm) currentVrm.update(delta);
    renderer.render(scene, camera);
}
animate();

// ---- 感情タグパース + 表情制御 (Phase 3) ----

const PRESET_EXPRESSIONS = ['neutral','happy','sad','angry','surprised','relaxed'];

function parseAgentResponse(raw) {
    if (typeof raw !== 'string') return { text: String(raw), emotion: null };
    const lines = raw.trim().split('\n');
    const last  = lines[lines.length - 1].trim();
    let emotion = null;
    let text    = raw.trim();
    try {
        const parsed = JSON.parse(last);
        if (parsed && typeof parsed.emotion === 'string') {
            emotion = { name: parsed.emotion, intensity: parsed.intensity ?? 1.0 };
            text = lines.slice(0, -1).join('\n').trim();
        }
    } catch (_) { /* タグなし */ }
    return { text, emotion };
}

function setExpression(name, intensity) {
    if (!currentVrm?.expressionManager) return;
    PRESET_EXPRESSIONS.forEach(e => currentVrm.expressionManager.setValue(e, 0));
    if (PRESET_EXPRESSIONS.includes(name)) {
        currentVrm.expressionManager.setValue(name, Math.min(1, Math.max(0, intensity)));
    }
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
    const p = document.createElement('p');
    p.textContent = `[${who}] ${text}`;
    p.dataset.who = who;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
}

// 最後のAIメッセージに追記する (Phase 4 ストリーミング用)
function appendToLastMessage(text) {
    const entries = log.querySelectorAll('p[data-who="AI"]');
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
        const entries = log.querySelectorAll('p[data-who="AI"]');
        if (entries.length > 0) {
            const last = entries[entries.length - 1];
            last.textContent = '[AI] ' + parsed.text;
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
