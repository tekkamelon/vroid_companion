// VRoid Companion — レンダラープロセス
// three.js + @pixiv/three-vrm はnpmからbundleせず、
// 開発中はCDNまたはnode_modules直参照を使うこと。
// (Electronはfile://でnode_modulesにアクセス可能)

import * as THREE from '../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../../node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';

const canvas = document.getElementById('vrm-canvas');
const log    = document.getElementById('log');
const input  = document.getElementById('msg-input');
const btn    = document.getElementById('send-btn');
const bootNote = document.getElementById('boot-note');

const status = document.createElement('div');
status.id = 'status';
status.textContent = 'starting...';
document.body.appendChild(status);

function report(text) {
    status.textContent = text;
    if (bootNote) bootNote.textContent = text;
}

window.addEventListener('error', (event) => {
    report(`JS error: ${event.message}`);
    console.error(event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
    report(`Promise rejected: ${event.reason?.message ?? event.reason}`);
    console.error(event.reason);
});

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
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const needResize = canvas.width !== Math.floor(width * window.devicePixelRatio)
        || canvas.height !== Math.floor(height * window.devicePixelRatio);
    if (!needResize) return;

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCurrentVrm();
    report(`renderer ${width}x${height}`);
}
window.addEventListener('resize', () => {
    resizeRenderer();
    frameCurrentVrm();
});

function frameCurrentVrm() {
    if (!currentVrm || !framing) return;

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const topY = framing.sizeY / 2;
    const fullHeight = framing.sizeY;

    // 画面内に「頭頂〜太もも付近」を安定して収める。
    const focusTop = topY - fullHeight * 0.02;
    const focusBottom = topY - fullHeight * 0.70;
    const focusHeight = focusTop - focusBottom;
    const focusCenterY = (focusTop + focusBottom) * 0.5;

    // Tポーズ腕幅は無視し、胴体幅ベースで横方向だけ最低限見る。
    const torsoWidth = fullHeight * 0.42;
    const distanceByHeight = (focusHeight * 0.5) / Math.tan(vFov / 2);
    const distanceByWidth = (torsoWidth * 0.5) / Math.tan(hFov / 2);
    const distance = Math.max(distanceByHeight, distanceByWidth) * 1.03;

    camera.position.set(0, focusCenterY + fullHeight * 0.16, distance);
    camera.near = Math.max(distance / 100, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    cameraTarget.set(0, focusCenterY + fullHeight * 0.12, 0);
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

// ---- 表情制御ユーティリティ ----
function setExpression(name, weight) {
    if (!currentVrm?.expressionManager) return;
    currentVrm.expressionManager.setValue(name, weight);
}

// ---- チャットUI ----
function appendLog(who, text) {
    const p = document.createElement('p');
    p.textContent = `[${who}] ${text}`;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
}

async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendLog('You', text);
    const resp = await window.companion.sendMessage(text);
    if (resp?.text) appendLog('AI', resp.text);
    if (resp?.emotion) setExpression(resp.emotion, resp.intensity ?? 1.0);
}

btn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

window.companion.onResponse((data) => {
    if (data?.text) appendLog('AI', data.text);
    if (data?.emotion) setExpression(data.emotion, data.intensity ?? 1.0);
});

// ---- 初期VRMロード (モデルがあれば) ----
loadVrm(new URL('../assets/models/model.vrm', import.meta.url).href);
