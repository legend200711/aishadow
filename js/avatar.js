import * as THREE from "three";

const container = document.getElementById("avatar-container");

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, -0.16, 4.5);
camera.lookAt(0, -0.16, 0);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0x55bbff, 1.5));

const keyLight = new THREE.PointLight(0x00cfff, 30, 8);
keyLight.position.set(-2, 1.5, 3);
scene.add(keyLight);

const greenLight = new THREE.PointLight(0x00ff99, 12, 7);
greenLight.position.set(2, -1, -1);
scene.add(greenLight);

const avatar = new THREE.Group();
scene.add(avatar);

let updateJawAnimation = () => {};
let updateBlinkAnimation = () => {};
let updateEyeMovement = () => {};

let currentAIState = "IDLE";
window.setShadowAIState = function(state) {
    const allowedStates = [
        "IDLE", "LISTENING", "THINKING",
        "PROCESSING", "SPEAKING",
        "SLEEPING", "STANDBY", "OFFLINE"
    ];

    const normalized = String(state || "IDLE").toUpperCase();

    if (allowedStates.includes(normalized)) {
        currentAIState = normalized;
    }
};

async function loadAvatar() {
    const response = await fetch("assets/shadow-head.json");
    if (!response.ok) {
        throw new Error("Could not load the Shadow Reaper head asset.");
    }

    const data = await response.json();

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(data.verts.flat(), 3)
    );

    geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(data.normals.flat(), 3)
    );

    geometry.setIndex(data.faces.flat());
    geometry.computeBoundingSphere();

    const originalPositions = new Float32Array(data.verts.flat());
    const jawWeights = data.jaw;
    const jawPivot = new THREE.Vector3(0.0, 0.06, -0.34);
    let jawAmount = 0;
    let jawTarget = 0;

    // Desktop-style eyebrow expression state.
    let browAmount = 0;
    let browBias = 0;
    let browSlowAmp = 0;
    let browExpression = 0;
    let browExpressionTarget = 0;
    let nextBrowExpression = 0;
    let browLineData = [];


    const headMaterial = new THREE.MeshStandardMaterial({
        color: 0x36cfff,
        emissive: 0x006b9c,
        emissiveIntensity: 1.1,
        metalness: 0.65,
        roughness: 0.3,
        transparent: true,
        opacity: 0.68,
        side: THREE.DoubleSide
    });

    updateJawAnimation = function(dt) {
        // Temporary demonstration: gentle speech-like mouth movement.
        const t = clock.elapsedTime;
        jawTarget = Math.max(
            0,
            Math.sin(t * 5.2) * 0.5 + Math.sin(t * 2.7) * 0.25
        );

        const tau = jawTarget > jawAmount ? 0.022 : 0.012;
        const smoothing = 1 - Math.exp(-dt / tau);
        jawAmount += (jawTarget - jawAmount) * smoothing;

        // Port the desktop avatar's speech and expression-driven brows.
        const live = jawTarget > 0.04;
        const env = live ? jawTarget : 0;
        const ampRate = env > browSlowAmp ? 0.16 : 0.36;
        browSlowAmp += (env - browSlowAmp) *
            (1 - Math.exp(-dt / ampRate));

        if (live) {
            if (t >= nextBrowExpression) {
                browExpressionTarget = -0.35 +
                    Math.random() * 1.35;
                nextBrowExpression = t + 0.8;
            }
        } else {
            browExpressionTarget = 0;
            nextBrowExpression = t + 0.8;
        }

        browExpression +=
            (browExpressionTarget - browExpression) * 0.075;

        let biasTarget = 0;

        if (currentAIState === "THINKING" ||
            currentAIState === "PROCESSING") {
            biasTarget = -0.28;
        } else if (
            currentAIState === "SLEEPING" ||
            currentAIState === "STANDBY" ||
            currentAIState === "OFFLINE"
        ) {
            biasTarget = -0.05;
        } else if (currentAIState === "LISTENING") {
            biasTarget = 0.10;
        }

        browBias += (biasTarget - browBias) * 0.06;

        const browTarget = Math.max(
            -0.4,
            Math.min(
                1.2,
                0.55 * browSlowAmp +
                0.60 * browExpression +
                browBias
            )
        );

        browAmount += (browTarget - browAmount) * 0.20;

        const angle = jawAmount * 0.115;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const positions = geometry.attributes.position;

        for (let i = 0; i < jawWeights.length; i++) {
            const base = i * 3;
            const x = originalPositions[base];
            const originalY = originalPositions[base + 1];
            const z = originalPositions[base + 2];

            let y = originalY;
            let finalZ = z;

            // Jaw rotation.
            const jawWeight = jawWeights[i];
            if (jawWeight > 0) {
                const dy = y - jawPivot.y;
                const dz = z - jawPivot.z;

                const rotatedY = jawPivot.y + dy * c - dz * s;
                const rotatedZ = jawPivot.z + dy * s + dz * c;

                y += (rotatedY - y) * jawWeight;
                finalZ += (rotatedZ - z) * jawWeight;
            }

            // Desktop brow formula: weight * lift * 0.14.
            y += (data.brow[i] || 0) * (browAmount * 0.14);

            positions.setXYZ(i, x, y, finalZ);
        }

        // Keep the visible eyebrow outlines attached to the moving face.
        for (const brow of browLineData) {
            for (let i = 0; i < brow.attribute.count; i++) {
                brow.attribute.setY(
                    i,
                    brow.original[i * 3 + 1] +
                    brow.weights[i] * (browAmount * 0.14)
                );
            }
            brow.attribute.needsUpdate = true;
        }

        positions.needsUpdate = true;
        geometry.computeVertexNormals();
    };

    const head = new THREE.Mesh(geometry, headMaterial);
    avatar.add(head);

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
            data.edges.flatMap(edge => [
                ...data.verts[edge[0]],
                ...data.verts[edge[1]]
            ]),
            3
        )
    );

    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x50eaff,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending
    });

    avatar.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

    const facialDetails = addFacialDetails(data);
    browLineData = facialDetails.browLines;

    // Keep the original head geometry centered in the projection.
    avatar.position.y = 0.16;

    addHolographicRings();
    addParticles();

    console.log("Shadow Reaper original avatar loaded.", data);
}

function addFacialDetails(data) {
    const landmarks = data.landmarks;
    const vertices = data.verts;

    const detailMaterial = new THREE.LineBasicMaterial({
        color: 0x8af5ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
    });

    const lipMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffbd,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending
    });

    function drawLandmarkLine(indices, material, closed = false) {
        if (!indices || indices.length < 2) return;

        const points = indices.map(index => {
            const vertex = vertices[index];
            return new THREE.Vector3(
                vertex[0],
                vertex[1],
                vertex[2] + 0.012
            );
        });

        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = closed
            ? new THREE.LineLoop(lineGeometry, material)
            : new THREE.Line(lineGeometry, material);

        avatar.add(line);
        return line;
    }

    const leftEye = drawLandmarkLine(landmarks.eye_l, detailMaterial, true);
    const rightEye = drawLandmarkLine(landmarks.eye_r, detailMaterial, true);

    const eyeLines = [leftEye, rightEye].filter(Boolean).map(line => {
        const attribute = line.geometry.attributes.position;
        const original = new Float32Array(attribute.array);
        let centerY = 0;

        for (let i = 0; i < attribute.count; i++) {
            centerY += original[i * 3 + 1];
        }

        centerY /= attribute.count;
        let centerX = 0;
        for (let i = 0; i < attribute.count; i++) {
            centerX += original[i * 3];
        }
        centerX /= attribute.count;

        return { attribute, original, centerY, centerX };
    });

    let nextBlink = 2.5 + Math.random() * 2.5;
    let blinkStart = -1;

    let gazeX = 0;
    let gazeY = 0;
    let targetGazeX = 0;
    let targetGazeY = 0;
    let nextGazeChange = 1.5;

    updateBlinkAnimation = function() {
        // Blinking is now handled by the combined eye controller.
    };

    updateEyeMovement = function(time) {
        // Schedule natural blinks.
        if (blinkStart < 0 && time >= nextBlink) {
            blinkStart = time;
        }

        let blinkAmount = 0;

        if (blinkStart >= 0) {
            const progress = (time - blinkStart) / 0.20;

            if (progress >= 1) {
                blinkStart = -1;
                nextBlink = time + 2.5 + Math.random() * 3.5;
            } else {
                blinkAmount = Math.sin(progress * Math.PI);
            }
        }

        // Occasionally shift the gaze.
        if (time >= nextGazeChange) {
            targetGazeX = (Math.random() - 0.5) * 0.045;
            targetGazeY = (Math.random() - 0.5) * 0.025;
            nextGazeChange = time + 1.8 + Math.random() * 2.8;
        }

        const smoothing = 0.035;
        gazeX += (targetGazeX - gazeX) * smoothing;
        gazeY += (targetGazeY - gazeY) * smoothing;

        // Apply blinking and gaze together so neither overwrites the other.
        const verticalScale = 1 - blinkAmount * 0.92;

        for (const eye of eyeLines) {
            for (let i = 0; i < eye.attribute.count; i++) {
                const originalY = eye.original[i * 3 + 1];

                eye.attribute.setXYZ(
                    i,
                    eye.original[i * 3] + gazeX,
                    eye.centerY +
                        (originalY - eye.centerY) * verticalScale +
                        gazeY,
                    eye.original[i * 3 + 2]
                );
            }

            eye.attribute.needsUpdate = true;
        }
    };

    const browLines = [
        { line: drawLandmarkLine(landmarks.brow_l, detailMaterial),
          indices: landmarks.brow_l },
        { line: drawLandmarkLine(landmarks.brow_r, detailMaterial),
          indices: landmarks.brow_r }
    ].filter(item => item.line).map(item => {
        const attribute = item.line.geometry.attributes.position;
        return {
            attribute,
            original: new Float32Array(attribute.array),
            weights: item.indices.map(index => data.brow[index] || 0)
        };
    });
    drawLandmarkLine(landmarks.lips_out, lipMaterial, true);
    drawLandmarkLine(landmarks.lips_in, detailMaterial, true);

    console.log("Shadow Reaper facial highlights installed.");
    return { browLines };
}

function addHolographicRings() {
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x00bfff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide
    });

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.12, 0.009, 8, 120),
        ringMaterial
    );

    ring.rotation.x = Math.PI / 2.35;
    ring.position.y = -0.65;
    ring.userData.rotationSpeed = 0.18;
    avatar.add(ring);

    const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.92, 0.006, 8, 120),
        new THREE.MeshBasicMaterial({
            color: 0x00ff9d,
            transparent: true,
            opacity: 0.32
        })
    );

    innerRing.rotation.x = Math.PI / 2.1;
    innerRing.rotation.y = 0.35;
    innerRing.position.y = -0.65;
    innerRing.userData.rotationSpeed = -0.25;
    avatar.add(innerRing);
}

function addParticles() {
    const count = 160;
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 3.2;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 3.2;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 1.8;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
    );

    const particles = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            color: 0x4bdfff,
            size: 0.018,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending
        })
    );

    particles.userData.rotationSpeed = 0.025;
    avatar.add(particles);
}

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.05);

    avatar.rotation.y = Math.sin(clock.elapsedTime * 0.32) * 0.055;
    updateJawAnimation(dt);
    updateBlinkAnimation(clock.elapsedTime);
    updateEyeMovement(clock.elapsedTime);

    avatar.children.forEach(child => {
        if (child.userData.rotationSpeed) {
            child.rotation.z += child.userData.rotationSpeed * dt;
        }
    });

    renderer.render(scene, camera);
}

function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (!width || !height) return;

    camera.aspect = width / height;

    // Keep the whole head visible on narrow and wide screens.
    camera.fov = width < 600 ? 43 : 38;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height, false);
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(container);

loadAvatar()
    .then(() => {
        resize();
        animate();
    })
    .catch(error => {
        console.error(error);
        container.innerHTML =
            '<div style="padding:30px;color:#ff9b9b">Avatar loading failed. Check the browser console.</div>';
    });



