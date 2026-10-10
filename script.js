document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lenis Smooth Scroll only for desktop non-touch devices
    let lenis = null;
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches;
    const isDesktopScreen = window.innerWidth >= 768;

    if (typeof Lenis !== 'undefined' && !isTouchDevice && isDesktopScreen) {
        lenis = new Lenis({
            duration: 1.2,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            orientation: 'vertical',
            gestureOrientation: 'vertical',
            smoothWheel: true,
            wheelMultiplier: 1,
            touchMultiplier: 1,
            infinite: false,
        });

        function raf(time) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);
    }
    // Global non-draggable images utility
    const makeImagesNonDraggable = () => {
        document.querySelectorAll('img').forEach(img => {
            img.setAttribute('draggable', 'false');
        });
    };
    makeImagesNonDraggable();

    // Topographic Lines Background Effect (Exact WebGL implementation, self-hosted & zero dependencies)
    const initTopoLines = () => {
        const canvas = document.getElementById('topo-canvas');
        if (!canvas) return;

        const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false }) ||
                   canvas.getContext('experimental-webgl');
        if (!gl) return;

        const vsSource = `
            attribute vec2 a_pos;
            varying vec2 v_uv;
            void main(){
                v_uv = a_pos * 0.5 + 0.5;
                gl_Position = vec4(a_pos, 0.0, 1.0);
            }
        `;

        const fsSource = `
            precision highp float;
            varying vec2 v_uv;
            uniform vec2 u_res;
            uniform float u_time, u_speed, u_density, u_scale, u_warp, u_lineW, u_idxEvery, u_idxWeight, u_tint, u_relief, u_paper, u_bgalpha, u_colorCount;
            uniform vec2 u_mouse;
            uniform float u_mouseAct, u_mouseStr;
            uniform vec3 u_bg, u_ink0, u_ink1, u_c0, u_c1, u_c2, u_c3, u_c4;

            // Mobile-safe GPU hash (no trigonometric sin() precision loss on mobile GPUs)
            float hash(vec2 p){
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            // Quintic C2-continuous smooth noise to prevent derivative kinks
            float noise(vec2 p){
                vec2 i = floor(p), f = fract(p);
                f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
            }

            float fbm2(vec2 p, float t){
                float v = 0.0, a = 0.56;
                mat2 m = mat2(0.80, 0.60, -0.60, 0.80);
                vec2 sh = vec2(t * 0.11, t * 0.07);
                for(int i = 0; i < 2; i++){
                    v += a * noise(p + sh);
                    p = m * p * 2.02 + vec2(7.3, 3.1);
                    sh = m * sh * 1.35;
                    a *= 0.52;
                }
                return v * 1.18;
            }

            float fbm3(vec2 p, float t){
                float v = 0.0, a = 0.54;
                mat2 m = mat2(0.80, 0.60, -0.60, 0.80);
                vec2 sh = vec2(t * 0.10, t * 0.06);
                for(int i = 0; i < 3; i++){
                    v += a * noise(p + sh);
                    p = m * p * 2.02 + vec2(7.3, 3.1);
                    sh = m * sh * 1.35;
                    a *= 0.52;
                }
                return v * 1.04;
            }

            float fbm4(vec2 p, float t){
                float v = 0.0, a = 0.52;
                mat2 m = mat2(0.80, 0.60, -0.60, 0.80);
                vec2 sh = vec2(t * 0.085, t * 0.055);
                for(int i = 0; i < 4; i++){
                    v += a * noise(p + sh);
                    p = m * p * 2.03 + vec2(7.3, 3.1);
                    sh = m * sh * 1.35;
                    a *= 0.52;
                }
                return v * 1.02;
            }

            float terrain(vec2 p, float t){
                p = mat2(1.02, 0.20, -0.14, 0.92) * p;
                float base = fbm3(p * 0.5, t * 0.7);
                base = (base - 0.5) * 1.7 + 0.5;
                float hi = smoothstep(0.35, 0.85, base);
                float d = fbm4(p * 1.75 + vec2(13.7, 5.2), t);
                return base + (d - 0.50) * (0.30 + 0.50 * hi);
            }

            float height(vec2 uv, vec2 wOff, float t, float mAmp, float mR2){
                float h = terrain(uv * u_scale + wOff, t);
                vec2 mr = uv - u_mouse;
                h += mAmp * exp(-dot(mr, mr) / mR2);
                return h;
            }

            vec3 pick(float k){
                if(k < 0.5) return u_c0;
                if(k < 1.5) return u_c1;
                if(k < 2.5) return u_c2;
                if(k < 3.5) return u_c3;
                return u_c4;
            }

            vec3 ramp(float x){
                float f = clamp(x, 0.0, 1.0) * (u_colorCount - 1.0);
                float fr = fract(f);
                fr = fr * fr * (3.0 - 2.0 * fr);
                vec3 a = pick(floor(f)), b = pick(min(floor(f) + 1.0, u_colorCount - 1.0));
                return sqrt(mix(a * a, b * b, fr));
            }

            void main(){
                float aspect = u_res.x / max(u_res.y, 1.0);
                vec2 uv = vec2(v_uv.x * aspect, v_uv.y);
                float t = u_time * u_speed;
                float e = max(1.5 / max(u_res.y, 1.0), 0.0008);

                float mAct = u_mouseStr * u_mouseAct;
                float mAmp = mAct * 7.5 / max(u_density, 4.0);
                float mR = 0.085 + 0.050 * mAct;
                float mR2 = mR * mR;

                vec2 wOff = vec2(0.0);
                if (u_warp > 0.001) {
                    vec2 q = vec2(fbm2(uv * 0.8 + vec2(2.3, 9.1), t * 0.55), fbm2(uv * 0.8 + vec2(8.7, 3.9), t * 0.50));
                    wOff = (q - 0.5) * u_warp;
                }

                float h0 = height(uv, wOff, t, mAmp, mR2);
                float hx = height(uv + vec2(e, 0.0), wOff, t, mAmp, mR2);
                float hy = height(uv + vec2(0.0, e), wOff, t, mAmp, mR2);
                vec2 slope = vec2(hx - h0, hy - h0) / e;

                float N = u_density;
                float H = h0 * N;
                float gradPx = length(slope) * (1.0 / max(u_res.y, 1.0)) * N;
                gradPx = max(gradPx, 1e-4);
                float spacing = 1.0 / gradPx;
                float dInt = 0.5 - abs(fract(H) - 0.5);
                float dPx = dInt / gradPx;

                float ie = max(u_idxEvery, 2.0);
                float idx = floor(H + 0.5);
                float hasIdx = (u_idxEvery > 1.5) ? 1.0 : 0.0;
                float isIdx = hasIdx * (1.0 - step(0.5, mod(idx, ie)));

                float halfW = max(u_lineW * mix(0.5, 0.5 + 0.62 * u_idxWeight, isIdx), 0.25);
                float aa = 0.60;
                float line = 1.0 - smoothstep(halfW - aa, halfW + aa, dPx);
                line *= smoothstep(0.8, 2.2, spacing);
                float inkA = line * mix(0.65, 1.0, isIdx);

                vec2 mrel = uv - u_mouse;
                inkA = min(inkA * (1.0 + 0.30 * mAct * exp(-dot(mrel, mrel) / (mR2 * 5.0))), 1.0);

                float bandN = mix(1.0, ie, hasIdx);
                float Hi = H / bandN;
                float fi = fract(Hi);
                float stepAA = clamp(fi * bandN / max(gradPx * 1.5, 1e-4), 0.0, 1.0);
                float lev = clamp(((floor(Hi) + stepAA) * bandN / N + 0.18) * 0.78, 0.0, 1.0);
                vec3 fill = mix(u_bg, ramp(lev), u_tint);

                float shade = dot(slope, vec2(-0.51, 0.86));
                fill *= 1.0 + u_relief * clamp(shade * 0.13, -0.20, 0.24);

                float mot = noise(gl_FragCoord.xy * 0.055) * 0.65 + noise(gl_FragCoord.xy * 0.21 + 7.3) * 0.35;
                fill *= 1.0 + u_paper * (mot - 0.5) * 0.075;
                fill += u_paper * (hash(gl_FragCoord.xy) - 0.5) * 0.024;

                float vig = smoothstep(0.42, 0.85, length((v_uv - 0.5) * vec2(1.15, 1.0)));
                fill *= 1.0 - 0.05 * vig;

                vec3 inkCol = mix(u_ink0, u_ink1, isIdx);
                vec3 col = mix(fill, inkCol, inkA);

                col += (hash(gl_FragCoord.xy + fract(t * 3.7) * vec2(31.7, 17.3)) - 0.5) * 0.007;
                col = clamp(col, 0.0, 1.0);

                float alpha = max(u_bgalpha, clamp(inkA + u_tint * 0.4 * smoothstep(0.05, 0.6, lev), 0.0, 1.0));
                gl_FragColor = vec4(col, alpha);
            }
        `;

        const createShader = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.warn(gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = createShader(gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.warn(gl.getProgramInfoLog(program));
            return;
        }

        gl.useProgram(program);

        // Fullscreen quad triangle buffer
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        const aPos = gl.getAttribLocation(program, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        const uniforms = {};
        const getUniform = (name) => {
            if (!(name in uniforms)) uniforms[name] = gl.getUniformLocation(program, name);
            return uniforms[name];
        };

        const hexToRgb = (hex) => {
            let c = hex.replace('#', '');
            if (c.length === 3) c = c.split('').map(x => x + x).join('');
            const n = parseInt(c, 16);
            return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
        };

        // EXACT PREVIOUS CONFIGURATION VALUES:
        // colors="#f7f7f5,#f7f7f5,#f7f7f5,#f7f7f5"
        // bg="#f7f7f5"
        // speed="0.66"
        // density="11"
        // index-every="0"
        // index-weight="1.35"
        // line-weight="0.4"
        // tint="0"
        // relief="0"
        // scale="1.02"
        // warp="0"
        // paper="0.28"
        // mouse="0.34"

        const bgRgb = hexToRgb('#f7f7f5');
        const ink0Rgb = hexToRgb('#6a543b');
        const ink1Rgb = hexToRgb('#3e3226');
        const c0Rgb = hexToRgb('#f7f7f5');

        gl.uniform3f(getUniform('u_bg'), bgRgb[0], bgRgb[1], bgRgb[2]);
        gl.uniform3f(getUniform('u_ink0'), ink0Rgb[0], ink0Rgb[1], ink0Rgb[2]);
        gl.uniform3f(getUniform('u_ink1'), ink1Rgb[0], ink1Rgb[1], ink1Rgb[2]);
        gl.uniform3f(getUniform('u_c0'), c0Rgb[0], c0Rgb[1], c0Rgb[2]);
        gl.uniform3f(getUniform('u_c1'), c0Rgb[0], c0Rgb[1], c0Rgb[2]);
        gl.uniform3f(getUniform('u_c2'), c0Rgb[0], c0Rgb[1], c0Rgb[2]);
        gl.uniform3f(getUniform('u_c3'), c0Rgb[0], c0Rgb[1], c0Rgb[2]);
        gl.uniform3f(getUniform('u_c4'), c0Rgb[0], c0Rgb[1], c0Rgb[2]);

        gl.uniform1f(getUniform('u_colorCount'), 4.0);
        gl.uniform1f(getUniform('u_bgalpha'), 1.0);
        gl.uniform1f(getUniform('u_speed'), 0.66);
        gl.uniform1f(getUniform('u_density'), 11.0);
        gl.uniform1f(getUniform('u_idxEvery'), 0.0);
        gl.uniform1f(getUniform('u_idxWeight'), 1.35);
        gl.uniform1f(getUniform('u_lineW'), 0.38);
        gl.uniform1f(getUniform('u_tint'), 0.0);
        gl.uniform1f(getUniform('u_relief'), 0.0);
        gl.uniform1f(getUniform('u_scale'), 1.02);
        gl.uniform1f(getUniform('u_warp'), 0.0);
        gl.uniform1f(getUniform('u_paper'), 0.28);
        gl.uniform1f(getUniform('u_mouseStr'), 0.34);

        const isMobileScreen = window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches;

        const resize = () => {
            // Render at crisp 1:1 CSS resolution (DPR 1.0 on mobile, up to 1.5 on desktop)
            // This ensures lines are razor-sharp, fine-pointed, and completely free of blurriness
            const dpr = isMobileScreen ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.5);
            const w = Math.max(1, Math.round(window.innerWidth * dpr));
            const h = Math.max(1, Math.round(window.innerHeight * dpr));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                gl.viewport(0, 0, w, h);
                gl.uniform2f(getUniform('u_res'), w, h);
            }
        };

        window.addEventListener('resize', resize, { passive: true });
        resize();

        let mouseX = 0.5, mouseY = 0.5;
        let smoothX = 0.5, smoothY = 0.5;
        let mouseAct = 0;
        let lastMove = -1e9;

        // Only attach mouse/pointer listener if user has a precise pointer (desktop mouse/trackpad)
        if (window.matchMedia('(pointer: fine)').matches) {
            window.addEventListener('pointermove', (e) => {
                mouseX = e.clientX / window.innerWidth;
                mouseY = e.clientY / window.innerHeight;
                lastMove = performance.now();
            }, { passive: true });
        }

        const startTime = performance.now();
        let animId = null;

        const render = () => {
            if (document.hidden) {
                animId = requestAnimationFrame(render);
                return;
            }

            const now = performance.now();
            const elapsed = (now - startTime) / 1000;

            smoothX += (mouseX - smoothX) * 0.07;
            smoothY += (mouseY - smoothY) * 0.07;
            mouseAct += ((now - lastMove < 2500 ? 1 : 0) - mouseAct) * 0.045;

            const aspect = canvas.width / Math.max(canvas.height, 1);
            gl.uniform2f(getUniform('u_mouse'), smoothX * aspect, 1.0 - smoothY);
            gl.uniform1f(getUniform('u_mouseAct'), mouseAct);
            gl.uniform1f(getUniform('u_time'), elapsed);

            gl.drawArrays(gl.TRIANGLES, 0, 3);
            animId = requestAnimationFrame(render);
        };

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gl.uniform1f(getUniform('u_time'), 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        } else {
            animId = requestAnimationFrame(render);
        }
    };
    initTopoLines();

    const laptop = document.querySelector('.laptop');
    const laptopBlock = document.querySelector('.laptop-block');
    const laptopTop = document.querySelector('.laptop-top');
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    let revealLiveOrb = () => {
        const orb = document.getElementById('live-orb-mascot');
        if (orb) orb.classList.add('orb-visible');
    };
    let setLiveOrbRoll = (pitch = 0, yaw = 0, tilt = 0) => {};

    let isRidingMarquee = false;
    let ridingItem = null;
    let finalGoalItem = null;
    let ridingAlt = '';
    let lastKnownX = null;
    let lastGoalX = null;
    let hopStartTime = 0;
    let currentHopDuration = 440;
    let hopFromX = 0;
    let hopFromY = 0;
    let landingAnchorX = null;
    let landingAnchorY = null;
    let isAtAnchor = false;
    let returnToAnchorTimer = null;
    let startAnchoredAtMarquee = () => {};
    let startRidingMarquee = () => {};
    let stopRidingMarquee = () => {};
    let updateRidingOrb = () => {};
    let handleMarqueeItemClick = () => {};
    let ensureLoopRunning = () => {};

    if (isDesktop && laptop && laptopBlock && laptopTop) {
        let currentProgress = 1; // Start fully closed
        let targetProgress = 1;
        let currentJump = 0; // 0 = resting on closed laptop lid, 1 = landed in front 3D space
        let targetJump = 0;
        let currentTravel = 0; // 0 = at 3D landing spot, 1 = bottom of About portrait
        let targetTravel = 0;
        let currentProjects = 0; // 0 = at Projects entrance, 1 = bottom of Projects gap
        let targetProjects = 0;
        let projectsDepartureX = null;
        let projectsDepartureY = null;
        let lastKnownOrbX = null;
        let lastKnownOrbY = null;
        let rafId = null;
        let isLaptopVisible = false;
        let introComplete = false; // Flag: has the open-on-load animation finished?
        const screenContent = document.querySelector('.screen-content');
        let lastOpenScreenP0x = null;
        let lastOpenScreenP0y = null;
        let lastScrollPos = 0;

        // Smooth orthogonal runner with rounded fillet corners for About section travel
        const getAboutPathPoint = (progress, A, B, C, D, E) => {
            const r = 22; // smooth fillet radius for 90-degree corners
            const L1 = Math.max(1, (B.y - r) - A.y);
            const Arc1 = Math.PI * 0.5 * r;
            const L2 = Math.max(1, (B.x - r) - (C.x + r));
            const Arc2 = Math.PI * 0.5 * r;
            const L3 = Math.max(1, E.y - (C.y + r));

            const total = L1 + Arc1 + L2 + Arc2 + L3;
            const dist = Math.max(0, Math.min(1, progress)) * total;

            if (dist <= L1) {
                // Segment 1: Linear down from landing spot A towards 3+ card top
                const t = dist / L1;
                return { x: A.x, y: A.y + t * (B.y - r - A.y), rotZ: 0 };
            } else if (dist <= L1 + Arc1) {
                // Corner B: Smooth quarter-circle fillet turning left
                const t = (dist - L1) / Arc1;
                const angle = t * (Math.PI * 0.5);
                const cx = B.x - r;
                const cy = B.y - r;
                const x = cx + r * Math.cos(angle);
                const y = cy + r * Math.sin(angle);
                return { x, y, rotZ: t * 8 };
            } else if (dist <= L1 + Arc1 + L2) {
                // Segment 2: Linear horizontal left towards portrait left edge
                const t = (dist - L1 - Arc1) / L2;
                const x = (B.x - r) - t * ((B.x - r) - (C.x + r));
                const y = B.y;
                return { x, y, rotZ: 8 };
            } else if (dist <= L1 + Arc1 + L2 + Arc2) {
                // Corner C: Smooth quarter-circle fillet turning down along portrait edge
                const t = (dist - L1 - Arc1 - L2) / Arc2;
                const angle = (Math.PI * 0.5) + t * (Math.PI * 0.5);
                const cx = C.x + r;
                const cy = C.y + r;
                const x = cx + r * Math.cos(angle);
                const y = cy - r * Math.sin(angle);
                return { x, y, rotZ: (1 - t) * 8 };
            } else {
                // Segment 3 & 4: Straight down along the left edge of portrait container past D to E
                const t = (dist - L1 - Arc1 - L2 - Arc2) / L3;
                const y = (C.y + r) + t * (E.y - (C.y + r));
                return { x: C.x, y, rotZ: 0 };
            }
        };

        const positionExperienceShoes = (heroRect, targetBallX = null) => {
            const expShoes = document.getElementById('experience-mini-shoes');
            const expSec = document.getElementById('experience');
            const expTimeline = expSec ? (expSec.querySelector('.md\\:col-span-8') || expSec.querySelector('.border-t')) : null;
            const expTitleCol = expSec ? expSec.querySelector('.md\\:col-span-4') : null;
            let shoesWorldY = 0;
            if (expSec) {
                const sRect = expSec.getBoundingClientRect();
                const eRect = expTimeline ? expTimeline.getBoundingClientRect() : sRect;
                const tRect = expTitleCol ? expTitleCol.getBoundingClientRect() : sRect;
                if (sRect.width > 0) {
                    let shoesCenterX;
                    if (targetBallX !== null && heroRect) {
                        const ballCenterInHero = targetBallX + 21;
                        shoesCenterX = ballCenterInHero - (sRect.left - heroRect.left);
                    } else if (eRect.width > 0 && tRect.width > 0) {
                        const lineX = tRect.right - sRect.left;
                        const tlLeft = eRect.left - sRect.left;
                        shoesCenterX = (lineX + tlLeft) * 0.5;
                    } else {
                        shoesCenterX = sRect.width * 0.35;
                    }
                    const shoesLocalY = (eRect.bottom - sRect.top) + 26;
                    if (heroRect) {
                        shoesWorldY = (eRect.bottom - heroRect.top) + 26;
                    }
                    if (expShoes) {
                        expShoes.style.left = `${(shoesCenterX - 19).toFixed(1)}px`;
                        expShoes.style.top = `${shoesLocalY.toFixed(1)}px`;
                    }
                }
            }
            return shoesWorldY;
        };

        let isOrbClimbWalking = false;
        let lastAutoWalkTimestamp = null;
        let autoWalkTime = 0;
        let autoWalkDist = 0;
        let autoWalkArriveTime = null;

        let isOrbVortexSucking = false;
        let lastSuckTimestamp = null;
        let orbSuckTime = 0;
        let hasOrbBeenAbsorbed = false;
        let contactDepartureX = null;
        let contactDepartureY = null;

        const getProjectsCardPathPoint = (progress, depX, depY, heroRect, shoesWorldY = 0) => {
            const cards = Array.from(document.querySelectorAll('#projects-grid > a'));
            const projectsSec = document.getElementById('projects');

            let c0Left, c0Right, c0Top;
            let c1Left, c1Right, c1Top, c1Center;
            let c2Left, c2Right, c2Top;
            let gap01X, gap12X, gapBottomY;

            if (cards.length >= 3) {
                const c0Rect = cards[0].getBoundingClientRect();
                const c1Rect = cards[1].getBoundingClientRect();
                const c2Rect = cards[2].getBoundingClientRect();

                c0Left = c0Rect.left - heroRect.left - 21;
                c0Right = c0Rect.right - heroRect.left - 21;
                c0Top = (c0Rect.top - heroRect.top) - 40;

                c1Left = c1Rect.left - heroRect.left - 21;
                c1Right = c1Rect.right - heroRect.left - 21;
                c1Top = (c1Rect.top - heroRect.top) - 40;
                c1Center = (c1Left + c1Right) * 0.5;

                c2Left = c2Rect.left - heroRect.left - 21;
                c2Right = c2Rect.right - heroRect.left - 21;
                c2Top = (c2Rect.top - heroRect.top) - 40;

                gap01X = (c0Right + c1Left) * 0.5;
                gap12X = (c1Right + c2Left) * 0.5;
            } else {
                const pRect = projectsSec ? projectsSec.getBoundingClientRect() : { left: heroRect.left, top: heroRect.top + 1200, width: heroRect.width, bottom: heroRect.top + 1700 };
                const pW = pRect.width || 1200;
                c0Left = pRect.left - heroRect.left + pW * 0.04 - 21;
                c0Right = pRect.left - heroRect.left + pW * 0.32 - 21;
                c1Left = pRect.left - heroRect.left + pW * 0.36 - 21;
                c1Right = pRect.left - heroRect.left + pW * 0.64 - 21;
                c1Center = (c1Left + c1Right) * 0.5;
                c2Left = pRect.left - heroRect.left + pW * 0.68 - 21;
                c2Right = pRect.left - heroRect.left + pW * 0.96 - 21;
                c0Top = (pRect.top - heroRect.top + 160) - 40;
                c1Top = c0Top;
                c2Top = c0Top;
                gap01X = (c0Right + c1Left) * 0.5;
                gap12X = (c1Right + c2Left) * 0.5;
            }

            // Coordinates of Experience section divider line & vertical seam
            const expSec = document.getElementById('experience');
            const expTimeline = expSec ? (expSec.querySelector('.md\\:col-span-8') || expSec.querySelector('.border-t')) : null;
            const expTitleCol = expSec ? expSec.querySelector('.md\\:col-span-4') : null;
            let expLineY = c0Top + 900;
            let seamX = gap01X - 60;
            if (expTimeline) {
                const eRect = expTimeline.getBoundingClientRect();
                if (eRect.width > 0) {
                    expLineY = (eRect.top - heroRect.top) - 40;
                }
            }
            if (expTitleCol && expTimeline) {
                const tRect = expTitleCol.getBoundingClientRect();
                const eRect = expTimeline.getBoundingClientRect();
                if (tRect.width > 0 && eRect.width > 0) {
                    const lineX = tRect.right - heroRect.left;
                    const tlLeft = eRect.left - heroRect.left;
                    // Center the ball right down the middle of the corridor inside the line (between vertical divider and timeline content)
                    const corridorCenter = (lineX + tlLeft) * 0.5;
                    seamX = corridorCenter - 21;
                } else if (tRect.width > 0) {
                    const lineX = tRect.right - heroRect.left;
                    seamX = lineX + 11;
                } else if (eRect.width > 0) {
                    const tlLeft = eRect.left - heroRect.left;
                    seamX = tlLeft - 53;
                }
            } else if (expTitleCol) {
                const tRect = expTitleCol.getBoundingClientRect();
                if (tRect.width > 0) {
                    const lineX = tRect.right - heroRect.left;
                    seamX = lineX + 11;
                }
            } else if (expTimeline) {
                const eRect = expTimeline.getBoundingClientRect();
                if (eRect.width > 0) {
                    const tlLeft = eRect.left - heroRect.left;
                    seamX = tlLeft - 53;
                }
            } else if (expSec) {
                const eRect = expSec.getBoundingClientRect();
                expLineY = (eRect.top - heroRect.top) + 60;
                seamX = (eRect.left + eRect.width * 0.35) - heroRect.left - 21;
            }

            // Function to compute the exact top surface Y coordinate of the tilted Running Marquee banner at any ball X
            const getMarqueeSurfaceYAtX = (ballX) => {
                const marqueeEl = document.querySelector('.marquee-container') || document.getElementById('marquee-track-1');
                if (!marqueeEl) return expLineY + 650;
                const mRect = marqueeEl.getBoundingClientRect();
                if (mRect.width <= 0) return expLineY + 650;
                const mcx = (mRect.left + mRect.width * 0.5) - heroRect.left;
                const mcy = (mRect.top + mRect.height * 0.5) - heroRect.top;
                const ballCx = ballX + 21;
                const dx = ballCx - mcx;
                const angleRad = -2 * (Math.PI / 180);
                const stripH = marqueeEl.offsetHeight || 60;
                // Top border edge of rotated marquee banner at ballCx
                return mcy - (stripH * 0.5) + dx * Math.tan(angleRad);
            };

            const getMarqueeYAtX = (ballX, soleOffset = 46.6) => {
                return getMarqueeSurfaceYAtX(ballX) - soleOffset;
            };

            const marqueeTop = getMarqueeYAtX(seamX);

            if (!shoesWorldY) {
                shoesWorldY = expLineY + 500;
            }

            // Determine target landing point on card top and destination gap based on ball's horizontal location
            let landingX = depX;
            let landingY = c0Top;
            let targetGapX = gap01X;
            let cardTop = c0Top;

            if (depX < c0Left) {
                // Far left of Card 0 -> plunge down left side of Card 0
                targetGapX = c0Left - 20;
                landingX = targetGapX;
                landingY = c0Top + 10;
                cardTop = c0Top;
            } else if (depX >= c0Left && depX < c0Right) {
                // Above Card 0 -> lands on top of Card 0, rolls right to Gap 01
                landingX = depX;
                landingY = c0Top;
                targetGapX = gap01X;
                cardTop = c0Top;
            } else if (depX >= c0Right && depX <= c1Left) {
                // Directly above Gap 01 -> jumps straight into Gap 01
                targetGapX = gap01X;
                landingX = gap01X;
                landingY = c0Top + 10;
                cardTop = c0Top;
            } else if (depX > c1Left && depX < c1Right) {
                // Above Card 1 (middle card) -> lands on Card 1
                landingX = depX;
                landingY = c1Top;
                cardTop = c1Top;
                // Nearest gap rule:
                if (depX < c1Center) {
                    targetGapX = gap01X; // roll left to Gap 01
                } else {
                    targetGapX = gap12X; // roll right to Gap 12
                }
            } else if (depX >= c1Right && depX <= c2Left) {
                // Directly above Gap 12 -> jumps straight into Gap 12
                targetGapX = gap12X;
                landingX = gap12X;
                landingY = c1Top + 10;
                cardTop = c1Top;
            } else if (depX > c2Left && depX <= c2Right) {
                // Above Card 2 -> lands on top of Card 2, rolls left to Gap 12
                landingX = depX;
                landingY = c2Top;
                targetGapX = gap12X;
                cardTop = c2Top;
            } else {
                // Far right of Card 2 -> plunge down right side of Card 2
                targetGapX = c2Right + 20;
                landingX = targetGapX;
                landingY = c2Top + 10;
                cardTop = c2Top;
            }

            const needsRoll = Math.abs(landingX - targetGapX) >= 20;
            const p = Math.max(0, Math.min(1, progress));

            if (p < 0.68) {
                lastAutoWalkTimestamp = null;
                autoWalkTime = 0;
                autoWalkDist = 0;
                autoWalkArriveTime = null;
                isOrbClimbWalking = false;
            }

            // Helper for downhill roll off-screen, then get shoes and climb-walk uphill
            const makeClimbWalk = (prog, pLand) => {
                isOrbClimbWalking = true;
                const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                if (lastAutoWalkTimestamp === null) {
                    lastAutoWalkTimestamp = now;
                }
                const dt = Math.min(0.1, (now - lastAutoWalkTimestamp) * 0.001);
                lastAutoWalkTimestamp = now;
                autoWalkTime += dt;

                const screenLeftX = heroRect ? -heroRect.left : 0;
                const winWidth = typeof window !== 'undefined' ? (window.innerWidth || 1440) : 1440;
                const screenRightX = heroRect ? (winWidth - heroRect.left) : winWidth;

                const rollDuration = 1.4; // 1.4s to roll downhill and out of screen
                const pauseDuration = 0.45; // 0.45s offscreen putting on shoes

                if (autoWalkTime < rollDuration) {
                    // STAGE 1: As it falls on the marquee, roll downhill to the left and go out the screen!
                    const t = autoWalkTime / rollDuration;
                    const rollEase = t * (0.7 + 0.3 * t); // Accelerating downhill under gravity
                    const exitX = screenLeftX - 80; // Completely off the screen to the left past viewport edge
                    const x = seamX + (exitX - seamX) * rollEase;
                    const y = getMarqueeSurfaceYAtX(x) - 46.6;

                    // Rolling rotation to the left (counter-clockwise)
                    const rollDist = x - seamX;
                    const rollAngle = rollDist * 0.16;
                    if (typeof setLiveOrbRoll === 'function') {
                        setLiveOrbRoll(0, rollAngle, 0);
                    }
                    if (typeof setLiveOrbLook === 'function') {
                        // Looking downhill in direction of roll
                        setLiveOrbLook(-0.75, 0.2);
                    }

                    return {
                        x,
                        y,
                        rotZ: -2.0, // Aligned with -2deg marquee surface
                        scaleX: 1.22,
                        scaleY: 1.22,
                        squeeze: 0,
                        hasShoes: false,
                        isClimbing: false
                    };
                } else if (autoWalkTime < rollDuration + pauseDuration) {
                    // STAGE 2: Off-screen putting on shoes!
                    if (typeof setLiveOrbRoll === 'function') {
                        setLiveOrbRoll(0, 0, 0);
                    }
                    const offX = screenLeftX - 120;
                    return {
                        x: offX, // Hidden off-screen
                        y: getMarqueeSurfaceYAtX(offX) - 46.6,
                        rotZ: 0,
                        scaleX: 1.25,
                        scaleY: 1.25,
                        squeeze: 0,
                        hasShoes: true, // Gets the shoes!
                        isClimbing: false
                    };
                } else {
                    // STAGE 3: Emerges from off-screen wearing shoes and walks uphill against opposing wind, completely exiting off the right edge!
                    const walkTime = autoWalkTime - (rollDuration + pauseDuration);
                    const startX = screenLeftX - 40; // Steps out from the true left screen edge
                    const targetEndX = screenRightX + 90; // Walks completely off the screen to the right
                    const maxMarchDist = Math.max(200, targetEndX - startX);

                    const isAtEnd = autoWalkDist >= maxMarchDist;
                    if (isAtEnd) {
                        autoWalkDist = maxMarchDist;
                        isOrbClimbWalking = false; // Finished walk off-screen, stop RAF loop
                    } else {
                        // How far across the screen the mascot has marched (0.0 at left, 1.0 at right)
                        const struggleFrac = Math.min(1, Math.max(0, autoWalkDist / (maxMarchDist * 0.85)));
                        const gustSurge = 0.5 + 0.5 * Math.sin(autoWalkTime * 4.2) * Math.cos(autoWalkTime * 1.8);
                        const windIntensity = Math.min(1, Math.max(0.12, Math.pow(struggleFrac, 0.75) * (0.8 + 0.35 * gustSurge)));
                        const currentSpeed = Math.max(28, 64 * (1 - windIntensity * 0.52));
                        autoWalkDist = Math.min(maxMarchDist, autoWalkDist + dt * currentSpeed);
                    }

                    const marchDist = autoWalkDist;

                    // Wind intensity: active during the struggle, stops once mascot exits the screen
                    let windIntensity;
                    if (isAtEnd) {
                        windIntensity = 0;
                    } else {
                        const struggleFrac = Math.min(1, Math.max(0, autoWalkDist / (maxMarchDist * 0.85)));
                        const gustSurge = 0.5 + 0.5 * Math.sin(autoWalkTime * 4.2) * Math.cos(autoWalkTime * 1.8);
                        windIntensity = Math.min(1, Math.max(0.12, Math.pow(struggleFrac, 0.75) * (0.8 + 0.35 * gustSurge)));
                    }

                    // Micro pushback from powerful wind gusts pushes mascot back slightly while walking:
                    const gustPushback = isAtEnd ? 0 : (Math.max(0, Math.sin(autoWalkTime * 5.5)) * (windIntensity * 3.5));
                    const x = startX + marchDist - gustPushback;

                    // Stride phase
                    const walkPhase = autoWalkDist * 0.15708;

                    // Heavy impact dip on foot plant: body sinks down into the surface (+y) under weight & wind
                    const stepImpact = Math.pow(Math.sin(walkPhase * 2), 2);
                    const bobY = isAtEnd ? 0 : (stepImpact * (2.2 + windIntensity * 2.2));

                    // Aerodynamic squash & hunkering down against resistance
                    const windSquash = windIntensity * 0.10;
                    const walkSquash = stepImpact * 0.045;
                    const scaleX = 1.25 + walkSquash + windSquash;
                    const scaleY = 1.25 - walkSquash - windSquash * 0.75;

                    // Lock mascot container root to marquee surface slope (-2.0deg) so shoes ground plane is parallel
                    const rotZ = -2.0;

                    // Forward lean against opposing headwind pivots the body/torso from the ankles/feet
                    const windLean = 10.0 + windIntensity * 18.0;
                    const gustShudder = Math.sin(autoWalkTime * 16) * (windIntensity * 1.8);
                    const bodyLean = windLean + Math.sin(walkPhase) * 1.5 + gustShudder;

                    // Exact sole bottom offset so shoes sit directly ON TOP of the white marquee line
                    const soleBottomOffset = 21 + 33.8 * scaleY;
                    const y = getMarqueeSurfaceYAtX(x) - soleBottomOffset + bobY;

                    // No sphere rolling while walking! Eyes squinting forward into the headwind
                    if (typeof setLiveOrbRoll === 'function') {
                        setLiveOrbRoll(0, 0, 0);
                    }
                    if (typeof setLiveOrbLook === 'function') {
                        setLiveOrbLook(0.85, 0.18 - windIntensity * 0.14);
                    }

                    return {
                        x,
                        y,
                        rotZ,
                        bodyLean,
                        scaleX,
                        scaleY,
                        squeeze: 0,
                        hasShoes: true,
                        isClimbing: true,
                        climbDist: autoWalkDist,
                        bobY: bobY,
                        windIntensity: windIntensity,
                        isAtEnd: isAtEnd
                    };
                }
            };

            const isRightHole = targetGapX > c1Center;

            if (!needsRoll) {
                if (p <= 0.18) {
                    // Segment 1: Parabolic jump into card gap
                    const u = p / 0.18;
                    const lift = Math.sin(u * Math.PI) * 42;
                    const easeU = u * u * (3 - 2 * u);
                    const x = depX + (targetGapX - depX) * easeU;
                    const y = depY + (cardTop + 10 - depY) * u - lift;
                    const dirX = Math.sign(targetGapX - depX) || 1;
                    const rotZ = Math.sin(u * Math.PI) * (dirX * 16);
                    const scaleX = 1.25 + Math.sin(u * Math.PI) * 0.12;
                    const scaleY = 1.25 - Math.sin(u * Math.PI) * 0.08;
                    if (typeof setLiveOrbRoll === 'function') {
                        setLiveOrbRoll(u * Math.PI * 2, 0, 0);
                    }
                    return { x, y, rotZ, scaleX, scaleY, squeeze: 0 };
                } else if (!isRightHole) {
                    // LEFT HOLE: Plunges down seamX to Marquee, then climb-walks uphill
                    if (p <= 0.70) {
                        const w = (p - 0.18) / 0.52;
                        const fallEase = w * (0.85 + 0.15 * w);
                        const y = (cardTop + 10) + (marqueeTop - (cardTop + 10)) * fallEase;
                        const x = seamX;

                        let scaleX = 1.22;
                        let scaleY = 1.22;
                        let squeezeVal = 0;
                        if (w <= 0.32) {
                            const sqProgress = w / 0.32;
                            const squeezeFactor = Math.sin(sqProgress * Math.PI);
                            scaleX = 1.22 - squeezeFactor * (1.22 - 0.65);
                            scaleY = 1.22 + squeezeFactor * (1.55 - 1.22);
                            squeezeVal = squeezeFactor;
                        } else if (w > 0.88) {
                            const imp = Math.sin(((w - 0.88) / 0.12) * Math.PI);
                            scaleX = 1.22 + imp * 0.24;
                            scaleY = 1.22 - imp * 0.18;
                        }

                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, 0, 0);
                        }
                        return {
                            x,
                            y,
                            rotZ: (w > 0.80 ? -2 * ((w - 0.80) / 0.20) : 0),
                            scaleX,
                            scaleY,
                            squeeze: squeezeVal,
                            hasShoes: false
                        };
                    } else {
                        return makeClimbWalk(p, 0.70);
                    }
                } else {
                    // RIGHT HOLE: Falls from right hole to Experience top line -> Rolls LEFT along line to seamX -> Plunges down seamX to Marquee
                    if (p <= 0.38) {
                        // Squeeze down between cards in right hole to Experience top line
                        const w = (p - 0.18) / 0.20;
                        const fallEase = w * w * (3 - 2 * w);
                        const x = targetGapX;
                        const y = (cardTop + 10) + (expLineY - (cardTop + 10)) * fallEase;
                        const squeezeFactor = Math.sin(w * Math.PI);
                        let scaleX = 1.22 - squeezeFactor * (1.22 - 0.65);
                        let scaleY = 1.22 + squeezeFactor * (1.55 - 1.22);
                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, 0, 0);
                        }
                        return { x, y, rotZ: 0, scaleX, scaleY, squeeze: squeezeFactor };
                    } else if (p <= 0.66) {
                        // Roll LEFT along horizontal Experience line from right gap to vertical seamX
                        const s = (p - 0.44) / 0.22;
                        const rollEase = s * s * (3 - 2 * s);
                        const x = targetGapX + (seamX - targetGapX) * rollEase;
                        const y = expLineY;
                        const rollDist = x - targetGapX;
                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, rollDist * 0.12, 0);
                        }
                        return { x, y, rotZ: 0, scaleX: 1.22, scaleY: 1.22, squeeze: 0 };
                    } else if (p <= 0.72) {
                        // Plunge straight down along vertical seamX to Running Marquee
                        const t = (p - 0.66) / 0.06;
                        const fallEase = t * (0.85 + 0.15 * t);
                        const x = seamX;
                        const y = expLineY + (marqueeTop - expLineY) * fallEase;
                        let scaleX = 1.22;
                        let scaleY = 1.22;
                        if (t > 0.88) {
                            const imp = Math.sin(((t - 0.88) / 0.12) * Math.PI);
                            scaleX = 1.22 + imp * 0.22;
                            scaleY = 1.22 - imp * 0.16;
                        }
                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, 0, 0);
                        }
                        return {
                            x,
                            y,
                            rotZ: (t > 0.85 ? -2 * ((t - 0.85) / 0.15) : 0),
                            scaleX,
                            scaleY,
                            squeeze: 0,
                            hasShoes: false
                        };
                    } else {
                        return makeClimbWalk(p, 0.72);
                    }
                }
            } else {
                // If needsRoll (jumped to card top first):
                if (p <= 0.14) {
                    // Segment 1: Parabolic jump to card top
                    const u = p / 0.14;
                    const lift = Math.sin(u * Math.PI) * 36;
                    const easeU = u * u * (3 - 2 * u);
                    const x = depX + (landingX - depX) * easeU;
                    const y = depY + (landingY - depY) * u - lift;
                    const dirX = Math.sign(landingX - depX) || 1;
                    const rotZ = Math.sin(u * Math.PI) * (dirX * 12);
                    let squashX = 1.25;
                    let squashY = 1.25;
                    if (u > 0.88) {
                        const imp = Math.sin(((u - 0.88) / 0.12) * Math.PI);
                        squashX = 1.25 + imp * 0.22;
                        squashY = 1.25 - imp * 0.18;
                    }
                    if (typeof setLiveOrbRoll === 'function') {
                        setLiveOrbRoll(u * Math.PI * 2, 0, 0);
                    }
                    return { x, y, rotZ, scaleX: squashX, scaleY: squashY, squeeze: 0 };
                } else if (p <= 0.28) {
                    // Segment 2: Roll along card top towards gap
                    const v = (p - 0.14) / 0.14;
                    const rollEase = v * v * (3 - 2 * v);
                    const x = landingX + (targetGapX - landingX) * rollEase;
                    const y = landingY;
                    const rollDist = x - landingX;
                    const rollYaw = rollDist * 0.08;
                    if (typeof setLiveOrbRoll === 'function') {
                        setLiveOrbRoll(0, rollYaw, 0);
                    }
                    return { x, y, rotZ: 0, scaleX: 1.22, scaleY: 1.22, squeeze: 0 };
                } else if (!isRightHole) {
                    // LEFT HOLE: Falls straight down seamX corridor to Running Marquee -> Climb-walks uphill
                    if (p <= 0.70) {
                        const w = (p - 0.28) / 0.42;
                        const fallEase = w * (0.85 + 0.15 * w);
                        const y = (landingY + 10) + (marqueeTop - (landingY + 10)) * fallEase;
                        const x = seamX;

                        let scaleX = 1.22;
                        let scaleY = 1.22;
                        let squeezeVal = 0;
                        if (w <= 0.32) {
                            const sqProgress = w / 0.32;
                            const squeezeFactor = Math.sin(sqProgress * Math.PI);
                            scaleX = 1.22 - squeezeFactor * (1.22 - 0.65);
                            scaleY = 1.22 + squeezeFactor * (1.55 - 1.22);
                            squeezeVal = squeezeFactor;
                        } else if (w > 0.88) {
                            const imp = Math.sin(((w - 0.88) / 0.12) * Math.PI);
                            scaleX = 1.22 + imp * 0.24;
                            scaleY = 1.22 - imp * 0.18;
                        }

                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, 0, 0);
                        }
                        return {
                            x,
                            y,
                            rotZ: (w > 0.80 ? -2 * ((w - 0.80) / 0.20) : 0),
                            scaleX,
                            scaleY,
                            squeeze: squeezeVal,
                            hasShoes: false
                        };
                    } else {
                        return makeClimbWalk(p, 0.70);
                    }
                } else {
                    // RIGHT HOLE: Falls from right hole to Experience top line -> Rolls LEFT along line to seamX -> Plunges down seamX to Marquee -> Climb-walks uphill
                    if (p <= 0.42) {
                        // Squeeze down between cards in right hole to Experience top line
                        const w = (p - 0.26) / 0.16;
                        const fallEase = w * w * (3 - 2 * w);
                        const x = targetGapX;
                        const y = (landingY + 10) + (expLineY - (landingY + 10)) * fallEase;
                        const squeezeFactor = Math.sin(w * Math.PI);
                        let scaleX = 1.22 - squeezeFactor * (1.22 - 0.65);
                        let scaleY = 1.22 + squeezeFactor * (1.55 - 1.22);
                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, 0, 0);
                        }
                        return { x, y, rotZ: 0, scaleX, scaleY, squeeze: squeezeFactor };
                    } else if (p <= 0.56) {
                        // Roll LEFT along horizontal Experience line from right gap to vertical seamX
                        const s = (p - 0.42) / 0.14;
                        const rollEase = s * s * (3 - 2 * s);
                        const x = targetGapX + (seamX - targetGapX) * rollEase;
                        const y = expLineY;
                        const rollDist = x - targetGapX;
                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, rollDist * 0.12, 0);
                        }
                        return { x, y, rotZ: 0, scaleX: 1.22, scaleY: 1.22, squeeze: 0 };
                    } else if (p <= 0.74) {
                        // Plunge straight down along vertical seamX to Running Marquee
                        const t = (p - 0.56) / 0.18;
                        const fallEase = t * (1.3 - 0.3 * t);
                        const x = seamX;
                        const y = expLineY + (marqueeTop - expLineY) * fallEase;
                        let scaleX = 1.22;
                        let scaleY = 1.22;
                        if (t > 0.88) {
                            const imp = Math.sin(((t - 0.88) / 0.12) * Math.PI);
                            scaleX = 1.22 + imp * 0.24;
                            scaleY = 1.22 - imp * 0.18;
                        }
                        if (typeof setLiveOrbRoll === 'function') {
                            setLiveOrbRoll(0, 0, 0);
                        }
                        return {
                            x,
                            y,
                            rotZ: (t > 0.80 ? -2 * ((t - 0.80) / 0.20) : 0),
                            scaleX,
                            scaleY,
                            squeeze: 0,
                            hasShoes: false
                        };
                    } else {
                        return makeClimbWalk(p, 0.74);
                    }
                }
            }
        };

        const updateOrbPath = (progress, jumpProgress = 0, travelProgress = 0, projectsProgress = 0) => {
            const orb = document.getElementById('live-orb-mascot');
            const hero = document.getElementById('desktop-hero');
            const laptopEl = document.querySelector('.laptop');
            const laptopBottom = document.querySelector('.laptop-bottom');
            const screenContentEl = document.querySelector('.screen-content');
            if (!orb || !hero) return;

            const heroRect = hero.getBoundingClientRect();
            const w = heroRect.width;
            const h = heroRect.height;
            if (w <= 0 || h <= 0) return;

            let lLeft = w * 0.5 - 540;
            let lRight = w * 0.5 + 540;
            let lTop = h * 0.08;
            let lBottom = h * 0.76;
            let cx = w * 0.5;

            if (laptopEl) {
                const lRect = laptopEl.getBoundingClientRect();
                if (lRect.width > 0) {
                    lLeft = lRect.left - heroRect.left;
                    lRight = lRect.right - heroRect.left;
                    lTop = lRect.top - heroRect.top;
                    lBottom = lRect.bottom - heroRect.top;
                    cx = lLeft + (lRect.width * 0.5);
                }
            }

            // Closed center lid position (target: sits cleanly on top rim of closed laptop lid right above notch)
            let p8x = cx - 21;
            let p8y = lBottom - 57;
            let targetFrontY = lBottom + 88;
            if (laptopBottom) {
                const bRect = laptopBottom.getBoundingClientRect();
                if (bRect.width > 0) {
                    p8x = (bRect.left + bRect.width * 0.5) - heroRect.left - 21;
                    p8y = (bRect.top - heroRect.top) - 57; // Lifted up to rest cleanly on top edge
                    targetFrontY = (bRect.bottom - heroRect.top) + 88;
                }
            }
            // Initial top-left screen position (resting on open laptop screen)
            let p0x = lLeft + 70;
            let p0y = lTop + 85;
            if (screenContentEl) {
                const sRect = screenContentEl.getBoundingClientRect();
                if (sRect.width > 0 && sRect.left > 0 && (lastOpenScreenP0x === null || progress < 0.10)) {
                    lastOpenScreenP0x = sRect.left - heroRect.left + 22;
                    lastOpenScreenP0y = sRect.top - heroRect.top + 16;
                }
            }
            if (lastOpenScreenP0x !== null) {
                p0x = lastOpenScreenP0x;
                p0y = lastOpenScreenP0y;
            }

                const box = orb.querySelector('.live-orb-box');
                const impactOverlay = document.getElementById('screen-impact-overlay');
                const shockwave = document.getElementById('glass-shockwave-ring');
                const portalEntry = document.getElementById('portal-entry');
                const portalExit = document.getElementById('portal-exit');
                const orbShoes = document.getElementById('live-orb-shoes');
                const expShoes = document.getElementById('experience-mini-shoes');
                const shoesWorldY = (typeof positionExperienceShoes === 'function') ? positionExperienceShoes(heroRect) : 0;
                const portalX = p8x + 21;
                const portalY = targetFrontY;

                if (portalEntry) {
                    portalEntry.style.left = `${portalX.toFixed(1)}px`;
                    portalEntry.style.top = `${portalY.toFixed(1)}px`;
                }

                if (projectsProgress <= 0.0001) {
                    if (box) {
                        box.style.transform = '';
                        box.style.transformOrigin = '';
                    }
                    autoWalkArriveTime = null;
                    if (orbShoes) {
                        orbShoes.style.opacity = '0';
                        const shoeL = orbShoes.querySelector('.mini-shoe-l');
                        const shoeR = orbShoes.querySelector('.mini-shoe-r');
                        if (shoeL) shoeL.setAttribute('transform', '');
                        if (shoeR) shoeR.setAttribute('transform', 'translate(19.5, 0)');
                    }
                    if (expShoes) expShoes.style.display = 'none';
                }

                if (projectsProgress > 0.0001 || travelProgress > 0.0001 || jumpProgress > 0.0001) {
                    if (impactOverlay) impactOverlay.style.opacity = '0';
                    if (shockwave) shockwave.style.opacity = '0';
                    hero.style.transform = '';
                }

                if (projectsProgress > 0.0001) {
                    // Phase 4: Selected Projects Path & Vertical Gap Squeeze
                    if (portalEntry) {
                        portalEntry.style.opacity = '0';
                        portalEntry.style.transform = 'translate(-50%, -50%) scale(0)';
                    }
                    if (portalExit) {
                        portalExit.style.opacity = '0';
                        portalExit.style.transform = 'translate(-50%, -50%) rotate(-26deg) scale(0)';
                    }
                    orb.style.opacity = '1';

                    // Latch departure position from the marquee the moment Phase 4 starts
                    if (projectsDepartureX === null) {
                        if (isRidingMarquee && ridingItem) {
                            const itemRect = ridingItem.getBoundingClientRect();
                            projectsDepartureX = (itemRect.left + itemRect.width * 0.5) - heroRect.left - 21;
                            projectsDepartureY = (itemRect.top - heroRect.top) - 40;
                        } else if (lastKnownOrbX !== null) {
                            projectsDepartureX = lastKnownOrbX;
                            projectsDepartureY = lastKnownOrbY;
                        } else {
                            const logoLoop = document.getElementById('logo-loop');
                            const lRect = logoLoop ? logoLoop.getBoundingClientRect() : null;
                            projectsDepartureX = lRect ? (lRect.left + lRect.width * 0.5) - heroRect.left - 21 : (heroRect.width * 0.5 - 21);
                            projectsDepartureY = lRect ? (lRect.top - heroRect.top) - 40 : (targetFrontY + 700);
                        }
                    }

                    if (isRidingMarquee) {
                        stopRidingMarquee();
                    }

                    // Phase 5: Only begin the descent when the Aether Vortex disc itself is revealed on screen!
                    const contactSec = document.getElementById('contact');
                    const cRect = contactSec ? contactSec.getBoundingClientRect() : null;
                    const winH = typeof window !== 'undefined' ? (window.innerHeight || 900) : 900;

                    const vCenter = (cRect && typeof window.getAetherVortexCenter === 'function')
                        ? window.getAetherVortexCenter()
                        : (cRect ? { floorX: cRect.width * 0.5, floorY: cRect.height * 0.76 } : null);

                    const vortexScreenY = (cRect && vCenter) ? (cRect.top + vCenter.floorY) : 99999;
                    const envelopeEl = document.getElementById('envelope-wrapper');
                    const envRect = envelopeEl ? envelopeEl.getBoundingClientRect() : null;

                    // Ensure the vortex disc itself is visibly revealed on screen before the orb begins its descent
                    const isVortexRevealed = (vortexScreenY <= winH * 0.88) || (envRect && envRect.top <= winH * 0.75);
                    const isContactActive = isVortexRevealed && (projectsProgress >= 0.70);

                    if (isContactActive) {
                        if (typeof window.updateMarqueeWindIntensity === 'function') {
                            window.updateMarqueeWindIntensity(0);
                        }

                        if (hasOrbBeenAbsorbed) {
                            // Orb has already joined the vortex disk and is living inside the canvas particle simulation
                            orb.style.opacity = '0';
                            orb.style.visibility = 'hidden';
                            if (orbShoes) {
                                orbShoes.style.opacity = '0';
                                orbShoes.style.pointerEvents = 'none';
                            }
                            return;
                        }

                        // Latch departure position from wherever the orb is walking on the marquee at this exact instant
                        if (contactDepartureX === null) {
                            const ptBefore = getProjectsCardPathPoint(projectsProgress, projectsDepartureX, projectsDepartureY, heroRect, shoesWorldY);
                            contactDepartureX = ptBefore.x;
                            contactDepartureY = ptBefore.y;
                        }

                        // Instantly remove shoes the moment it gets off the marquee
                        if (orbShoes) {
                            orbShoes.style.opacity = '0';
                            orbShoes.style.pointerEvents = 'none';
                        }

                        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                        if (lastSuckTimestamp === null) {
                            lastSuckTimestamp = now;
                        }
                        const dt = Math.min(0.08, (now - lastSuckTimestamp) * 0.001);
                        lastSuckTimestamp = now;

                        isOrbVortexSucking = true;
                        orbSuckTime += dt;

                        // Smooth, cinematic swoop trajectory (~1.25s duration from marquee to outer vortex rim)
                        const swoopDuration = 1.25;
                        const t = Math.min(1.0, orbSuckTime / swoopDuration);

                        // Coordinates of vortex center in Contact section
                        const vCenter = (typeof window.getAetherVortexCenter === 'function')
                            ? window.getAetherVortexCenter()
                            : { floorX: cRect.width * 0.5, floorY: cRect.height * 0.76 };

                        const vortexScreenX = cRect.left + vCenter.floorX;
                        const vortexScreenY = cRect.top + vCenter.floorY;
                        const vortexHeroX = vortexScreenX - heroRect.left;
                        const vortexHeroY = vortexScreenY - heroRect.top;

                        // 3D Perspective Parameters matching initAetherVortex (horizontal plate tilted at pitch = 1.47)
                        const pitch = 1.47;
                        const cosP = Math.cos(pitch);
                        const sinP = Math.sin(pitch);
                        const fov = 650;
                        const cameraZ = 650;
                        const maxR = Math.min(Math.max(cRect.width * 0.32, 280), 380);

                        // Departure point P0 from marquee
                        const P0 = { x: contactDepartureX, y: contactDepartureY };

                        // Target entry point P3: front rim of accretion disk matching user marked particle location
                        const entryAngle = Math.PI * 0.58; // ~104 degrees (front rim)
                        const entryRadius = maxR * 0.65;
                        const x3D_entry = Math.cos(entryAngle) * entryRadius;
                        const z3D_entry = Math.sin(entryAngle) * entryRadius;
                        const zCam_entry = cameraZ - z3D_entry * sinP;
                        const scaleEntry = fov / Math.max(50, zCam_entry);

                        const P3 = {
                            x: (vortexHeroX - 21) + x3D_entry * scaleEntry,
                            y: (vortexHeroY - 21) + (z3D_entry * cosP) * scaleEntry,
                        };

                        // Bezier Control points: sweep gracefully down along the left margin and round under to bottom rim
                        const P1 = {
                            x: Math.min(P0.x - 200, Math.max(heroRect.width * 0.07, 50)),
                            y: P0.y + (P3.y - P0.y) * 0.28,
                        };
                        const P2 = {
                            x: Math.max(heroRect.width * 0.05, P3.x - 140),
                            y: P3.y + 42,
                        };

                        // Target scale at disk rim: 7.0px diameter matching user's circled particle (42px * 0.167 = 7px)
                        const targetParticleScale = 0.167;

                        if (t < 1.0) {
                            // Phase A: Glide along marked swoop curve from marquee down left side to outer disk edge
                            const s = t * t * (3 - 2 * t); // Smooth Hermite curve
                            const b0 = (1 - s) * (1 - s) * (1 - s);
                            const b1 = 3 * (1 - s) * (1 - s) * s;
                            const b2 = 3 * (1 - s) * s * s;
                            const b3 = s * s * s;

                            const curX = b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x;
                            const curY = b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y;

                            // Smoothly scale down from marquee size (1.22) to exact 7px particle size (0.167)
                            const scaleFinal = 1.22 - (1.22 - targetParticleScale) * Math.pow(t, 1.25);

                            // Mascot eyes gently fade out during the swoop to become a pure dark sphere
                            const eyeL = document.getElementById('live-orb-fallback-eye-l');
                            const eyeR = document.getElementById('live-orb-fallback-eye-r');
                            if (eyeL && eyeR) {
                                const eyeFade = Math.max(0, 1.0 - t / 0.55);
                                eyeL.style.opacity = eyeFade.toFixed(2);
                                eyeR.style.opacity = eyeFade.toFixed(2);
                            }

                            orb.style.opacity = '1';
                            orb.style.visibility = 'visible';
                            orb.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) scale(${scaleFinal.toFixed(3)})`;
                            if (box) {
                                box.style.transformOrigin = 'center center';
                                box.style.transform = '';
                                const shadowAlpha = (0.35 * (1.0 - t)).toFixed(2);
                                box.style.filter = `drop-shadow(0 2px 6px rgba(0,0,0,${shadowAlpha}))`;
                            }
                            return;
                        } else {
                            // Phase B: Joins accretion disk, travels naturally to the center core, and mixes calmly with other particles!
                            const spiralTime = orbSuckTime - swoopDuration;

                            // Gentle, natural inward glide (2.4s) matching the radial collapse speed of surrounding vortex particles
                            const joinClusterDuration = 2.4;
                            const uJoin = Math.min(1.0, spiralTime / joinClusterDuration);
                            const easeJoin = 1.0 - Math.pow(1.0 - uJoin, 2.2);

                            // Dense core cluster radius (12.0px), dead-center in the black hole singularity marked by the user
                            const clusterBaseRadius = 12.0;
                            const orbitRadius = entryRadius + (clusterBaseRadius - entryRadius) * easeJoin;

                            // Orbital angular velocity: starts gentle at outer rim and matches the calm rotation of cluster particles (~1.55 rad/s)
                            const baseTheta = 1.35 * Math.pow(easeJoin, 1.8);
                            const postTheta = Math.max(0, spiralTime - joinClusterDuration) * 1.55;
                            const orbitAngle = entryAngle + baseTheta + postTheta;

                            // Flat disk undulation matching the canvas particles
                            const y3D = Math.sin(orbitAngle * 2 + spiralTime * 1.2) * 0.35;

                            const x3D = Math.cos(orbitAngle) * orbitRadius;
                            const z3D = Math.sin(orbitAngle) * orbitRadius;
                            const zCam = cameraZ - z3D * sinP - y3D * cosP;
                            const scale3D = fov / Math.max(50, zCam);

                            // Centers the 42x42 mascot (-21px) directly at the vortex center
                            const curX = (vortexHeroX - 21) + x3D * scale3D;
                            const curY = (vortexHeroY - 21) + (z3D * cosP + y3D * sinP) * scale3D;

                            // Starts at exact 7.0px (0.167) at foreground rim, scales down smoothly to cluster particle size (~3.6px / 0.086)
                            const clusterParticleScale = 0.086; // 42px * 0.086 = 3.6px diameter
                            const currentParticleScale = targetParticleScale + (clusterParticleScale - targetParticleScale) * easeJoin;
                            const scaleFinal = currentParticleScale * (scale3D / scaleEntry);

                            // Fully visible, blending seamlessly with the dense cluster of particles
                            orb.style.opacity = '0.95';
                            orb.style.visibility = 'visible';
                            orb.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) scale(${scaleFinal.toFixed(3)})`;
                            if (box) {
                                box.style.transformOrigin = 'center center';
                                box.style.transform = '';
                                box.style.filter = ''; // Flat clean black dot matching the vortex particles
                            }
                            return;
                        }
                    } else if (cRect && (vortexScreenY > winH * 0.96 || cRect.top > winH * 0.85)) {
                        // User scrolled back up above the visible vortex: reset cleanly to marquee
                        if (orbSuckTime > 0) {
                            orbSuckTime = 0;
                            lastSuckTimestamp = null;
                            isOrbVortexSucking = false;
                            hasOrbBeenAbsorbed = false;
                            contactDepartureX = null;
                            contactDepartureY = null;
                            orb.style.opacity = '1';
                            orb.style.visibility = 'visible';
                            const eyeL = document.getElementById('live-orb-fallback-eye-l');
                            const eyeR = document.getElementById('live-orb-fallback-eye-r');
                            if (eyeL && eyeR) {
                                eyeL.style.opacity = '1';
                                eyeR.style.opacity = '1';
                            }
                            if (box) {
                                box.style.filter = '';
                            }
                        }
                    }

                    const pt = getProjectsCardPathPoint(projectsProgress, projectsDepartureX, projectsDepartureY, heroRect, shoesWorldY);
                    if (typeof positionExperienceShoes === 'function') {
                        positionExperienceShoes(heroRect);
                    }

                    orb.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0) rotateZ(${pt.rotZ.toFixed(1)}deg) scale(${pt.scaleX.toFixed(3)}, ${pt.scaleY.toFixed(3)})`;

                    const wearsShoes = !!pt.hasShoes;
                    if (orbShoes) orbShoes.style.opacity = wearsShoes ? '1' : '0';

                    if (typeof window.updateMarqueeWindIntensity === 'function') {
                        if (pt.isClimbing && typeof pt.windIntensity === 'number') {
                            window.updateMarqueeWindIntensity(pt.windIntensity);
                        } else {
                            window.updateMarqueeWindIntensity(0);
                        }
                    }

                    // Animate mini shoes with cinematic heavy march gait kinematics (Loki determined uphill struggle feel)
                    if (orbShoes && pt.isClimbing) {
                        // Shoes stay parallel to the -2deg marquee surface,
                        // and counter-bob so the planted foot stays locked at surfaceY while the torso bobs!
                        orbShoes.style.transform = 'translateX(-50%)';
                        orbShoes.style.transformOrigin = '22px 14.8px';
                        if (typeof pt.bobY === 'number') {
                            orbShoes.style.top = `${(40 - pt.bobY / pt.scaleY).toFixed(1)}px`;
                        } else {
                            orbShoes.style.top = '40px';
                        }

                        const shoeL = orbShoes.querySelector('.mini-shoe-l');
                        const shoeR = orbShoes.querySelector('.mini-shoe-r');
                        const shadowL = orbShoes.querySelector('.shoe-shadow-l');
                        const shadowR = orbShoes.querySelector('.shoe-shadow-r');
                        const walkPhase = (pt.climbDist || 0) * 0.15708;

                        const getCinematicFoot = (phaseOffset) => {
                            const TWO_PI = Math.PI * 2;
                            const norm = (((walkPhase + phaseOffset) % TWO_PI) + TWO_PI) % TWO_PI;
                            const t = norm / TWO_PI; // [0, 1)

                            let dx, dy, rot, pivotX, pivotY, shadowOpacity, shadowScale;
                            pivotY = 14.8; // Rotate along the sole plane so toes and heels never penetrate the surface

                            if (t < 0.60) {
                                // STANCE PHASE (60%): Exact zero-slip ground lock
                                const u = t / 0.60;
                                // Reaches forward +12px on heel strike, powers back to -12px on push-off
                                dx = 12.0 - u * 24.0;
                                dy = 0; // Firmly grounded on the marquee top

                                if (u < 0.18) {
                                    // Heel strike: pivot is the heel (x=2), toe is angled up in the air (rot < 0)
                                    const k = u / 0.18;
                                    rot = -12.0 * (1 - k);
                                    pivotX = 2;
                                } else if (u < 0.68) {
                                    // Solid flat mid-stance: bearing full body weight
                                    rot = 0;
                                    pivotX = 10;
                                } else {
                                    // Push-off: pivot is the ball of foot (x=16), heel lifts up (rot > 0)
                                    const k = (u - 0.68) / 0.32;
                                    rot = 14.0 * k;
                                    pivotX = 16;
                                }
                                shadowOpacity = 0.85;
                                shadowScale = 1.05;
                            } else {
                                // SWING PHASE (40%): Deliberate forward step in the air
                                const v = (t - 0.60) / 0.40;
                                const easeV = 0.5 - 0.5 * Math.cos(v * Math.PI);
                                dx = -12.0 + easeV * 24.0;

                                // Agile step clearance parabolic arc (crisp 4.5px lift without body collision)
                                const liftCurve = Math.sin(v * Math.PI);
                                dy = -liftCurve * 4.5;

                                // Ankle flex in air: transitions from push-off (+14deg) to heel strike ready (-12deg)
                                rot = 14.0 * (1 - v) - 12.0 * v;
                                pivotX = 10;

                                // Dynamic contact shadow softens and shrinks during swing
                                shadowOpacity = 0.20 + 0.65 * (1 - liftCurve);
                                shadowScale = 0.68 + 0.37 * (1 - liftCurve);
                            }

                            return { dx, dy, rot, pivotX, pivotY, shadowOpacity, shadowScale };
                        };

                        const footL = getCinematicFoot(0);
                        const footR = getCinematicFoot(Math.PI);

                        // Base positions: Far foot (L) at x=10.5, Near foot (R) at x=13.5 (both centered under 44px mascot)
                        if (shoeL) {
                            shoeL.setAttribute('transform', `translate(${(10.5 + footL.dx).toFixed(1)}, ${footL.dy.toFixed(1)}) rotate(${footL.rot.toFixed(1)} ${footL.pivotX} ${footL.pivotY})`);
                        }
                        if (shoeR) {
                            shoeR.setAttribute('transform', `translate(${(13.5 + footR.dx).toFixed(1)}, ${footR.dy.toFixed(1)}) rotate(${footR.rot.toFixed(1)} ${footR.pivotX} ${footR.pivotY})`);
                        }
                        if (shadowL) {
                            shadowL.setAttribute('transform', `translate(${(footL.dx * 0.8).toFixed(1)}, 0) scale(${footL.shadowScale.toFixed(2)})`);
                            shadowL.style.opacity = footL.shadowOpacity.toFixed(2);
                        }
                        if (shadowR) {
                            shadowR.setAttribute('transform', `translate(${(footR.dx * 0.8).toFixed(1)}, 0) scale(${footR.shadowScale.toFixed(2)})`);
                            shadowR.style.opacity = footR.shadowOpacity.toFixed(2);
                        }
                    } else if (orbShoes) {
                        orbShoes.style.transform = 'translateX(-50%)';
                        orbShoes.style.transformOrigin = 'center center';
                        orbShoes.style.top = '40px';
                        const shoeL = orbShoes.querySelector('.mini-shoe-l');
                        const shoeR = orbShoes.querySelector('.mini-shoe-r');
                        const shadowL = orbShoes.querySelector('.shoe-shadow-l');
                        const shadowR = orbShoes.querySelector('.shoe-shadow-r');
                        if (shoeL) shoeL.setAttribute('transform', 'translate(10.5, 0)');
                        if (shoeR) shoeR.setAttribute('transform', 'translate(13.5, 0)');
                        if (shadowL) {
                            shadowL.setAttribute('transform', '');
                            shadowL.style.opacity = '0.6';
                        }
                        if (shadowR) {
                            shadowR.setAttribute('transform', '');
                            shadowR.style.opacity = '0.6';
                        }
                    }

                    if (box) {
                        if (pt.isClimbing && typeof pt.bodyLean === 'number') {
                            box.style.transformOrigin = '21px 38px';
                            box.style.transform = `rotate(${pt.bodyLean.toFixed(1)}deg)`;
                        } else {
                            box.style.transform = '';
                            box.style.transformOrigin = '';
                        }
                        if (pt.squeeze > 0.05) {
                            const shadowBlur = (12 - pt.squeeze * 4).toFixed(1);
                            const shadowY = (6 + pt.squeeze * 4).toFixed(1);
                            box.style.filter = `drop-shadow(0 ${shadowY}px ${shadowBlur}px rgba(0, 0, 0, 0.24))`;
                        } else {
                            box.style.filter = 'drop-shadow(0 6px 14px rgba(0, 0, 0, 0.18))';
                        }
                    }

                } else if (travelProgress > 0.0001) {
                    if (box) {
                        box.style.transform = '';
                        box.style.transformOrigin = '';
                    }
                    // If already safely landed and anchored in marquee mode, let ridingLoop smoothly drive the mascot
                    if (isRidingMarquee && travelProgress >= 0.95) {
                        return;
                    }

                    // Phase 3: Emerges from Portal 2 (tilted exit portal at arrow tail),
                    // shoots along curved arrow path, through the arrow head,
                    // flies down-right across under the portrait, and lands directly on the marquee tech icon it reaches!
                    const tt = Math.max(0, Math.min(1, travelProgress));

                    // Reset Entry Portal
                    if (portalEntry) {
                        portalEntry.style.opacity = '0';
                        portalEntry.style.transform = 'translate(-50%, -50%) scale(0)';
                    }

                    const aboutPortrait = document.getElementById('about-portrait-box');
                    const pRect = aboutPortrait ? aboutPortrait.getBoundingClientRect() : null;
                    const portraitLeftX = pRect ? (pRect.left - heroRect.left) - 21 : (p8x - 140);
                    const portraitTopY = pRect ? (pRect.top - heroRect.top) : (targetFrontY + 390);

                    // Get measured coordinates of Portal 2 (at arrow tail)
                    let pExitX = portraitLeftX - 160;
                    let pExitY = portraitTopY + 140;
                    const arrowContainer = document.getElementById('about-arrow-container');
                    if (arrowContainer) {
                        const acRect = arrowContainer.getBoundingClientRect();
                        if (acRect.width > 0) {
                            pExitX = (acRect.left + acRect.width * 0.52) - heroRect.left - 21;
                            pExitY = (acRect.top + acRect.height * 0.83) - heroRect.top - 21;
                        }
                    } else if (portalExit) {
                        const peRect = portalExit.getBoundingClientRect();
                        if (peRect.width > 0) {
                            pExitX = (peRect.left + peRect.width * 0.5) - heroRect.left - 21;
                            pExitY = (peRect.top + peRect.height * 0.5) - heroRect.top - 21;
                        }
                    }

                    // Get key coordinates of arrow from SVG
                    const arrowSvg = document.querySelector('#about-arrow-container svg');
                    let pApexX = pExitX - 35;
                    let pApexY = pExitY - 260;
                    let pHeadX = pExitX + 160;
                    let pHeadY = pExitY - 180;
                    if (arrowSvg) {
                        const aRect = arrowSvg.getBoundingClientRect();
                        if (aRect.width > 0) {
                            pApexX = (aRect.left + aRect.width * 0.35) - heroRect.left - 21;
                            pApexY = (aRect.top + aRect.height * 0.16) - heroRect.top - 21;
                            pHeadX = (aRect.left + aRect.width * 0.645) - heroRect.left - 21;
                            pHeadY = (aRect.top + aRect.height * 0.322) - heroRect.top - 21;
                        }
                    }

                    // Target landing on tech logo loop marquee at bottom of About section
                    const logoLoop = document.getElementById('logo-loop');
                    let landingY = pExitY + 220;
                    if (logoLoop) {
                        const lRect = logoLoop.getBoundingClientRect();
                        if (lRect.width > 0) {
                            landingY = (lRect.top - heroRect.top) + 21; // Icon top is lRect.top + 61, minus 40px for mascot = lRect.top + 21
                        }
                    }

                    // Follow the curved arrow head's natural tangent trajectory (slope dx/dy ~ 40/65 = 0.615):
                    // Shoots down-right from the arrow head straight into the tech icon in its direct path
                    const dyToLanding = Math.max(80, landingY - pHeadY);
                    let defaultLandingX = pHeadX + dyToLanding * 0.615;
                    if (logoLoop) {
                        const lRect = logoLoop.getBoundingClientRect();
                        if (lRect.width > 0) {
                            // Target corridor centered under the natural arrow direction (~46% - 48% of marquee)
                            const arrowTargetX = (lRect.left + lRect.width * 0.47) - heroRect.left - 21;
                            defaultLandingX = Math.min(arrowTargetX + 35, Math.max(arrowTargetX - 35, pHeadX + dyToLanding * 0.615));
                        }
                    }

                    // Find specific logo-loop-item closest to landing trajectory X coordinate
                    const loopItems = Array.from(document.querySelectorAll('.logo-loop-item'));
                    let targetItem = null;
                    let minItemDiff = Infinity;
                    loopItems.forEach(item => {
                        const ir = item.getBoundingClientRect();
                        if (ir.width > 0 && ir.left >= -60 && ir.right <= window.innerWidth + 60) {
                            const cx = (ir.left + ir.width * 0.5) - heroRect.left - 21;
                            const diff = Math.abs(cx - defaultLandingX);
                            if (diff < minItemDiff) {
                                minItemDiff = diff;
                                targetItem = item;
                            }
                        }
                    });

                    if (!targetItem && loopItems.length > 0) {
                        targetItem = loopItems.find(item => {
                            const ir = item.getBoundingClientRect();
                            return ir.width > 0 && ir.left >= -20 && ir.right <= window.innerWidth + 20;
                        }) || loopItems[0];
                    }

                    let finalLandingX = defaultLandingX;
                    let finalLandingY = landingY;
                    if (targetItem) {
                        const ir = targetItem.getBoundingClientRect();
                        finalLandingX = (ir.left + ir.width * 0.5) - heroRect.left - 21;
                        finalLandingY = (ir.top - heroRect.top) - 40;
                    }

                    if (portalEntry) {
                        portalEntry.style.opacity = '0';
                        portalEntry.style.transform = 'translate(-50%, -50%) scale(0)';
                    }

                    // Ensure orb box is crisp, full opacity (restored from Phase 2 plunge)
                    if (box) {
                        box.style.opacity = '1';
                    }

                    let curX = pExitX;
                    let curY = pExitY;
                    let totalScale = 1.35;
                    let squashX = 1;
                    let squashY = 1;
                    let shadowY = 6;
                    let shadowBlur = 12;
                    let shadowAlpha = 0.25;

                    if (tt <= 0.12) {
                        // Sub-phase 3a: Hole 2 opens tilted at -26deg
                        const openT = tt / 0.12;
                        const pScale = Math.sin(openT * Math.PI * 0.5);
                        if (portalExit) {
                            portalExit.style.opacity = '1';
                            portalExit.style.transform = `translate(-50%, -50%) rotate(-26deg) scale(${pScale.toFixed(3)})`;
                        }
                        curX = pExitX;
                        curY = pExitY;
                        totalScale = 0.01;
                        orb.style.opacity = '0';
                        setLiveOrbRoll(0, 0, 0);

                    } else {
                        // Sub-phase 3b: Ball shoots along curved arrow path, through arrow head, and lands on tech icon!
                        const flyT = (tt - 0.12) / 0.88; // 0.0 to 1.0

                        // Portal 2 stays open while ball emerges, then smoothly closes as ball arcs away
                        if (portalExit) {
                            if (flyT <= 0.28) {
                                portalExit.style.opacity = '1';
                                portalExit.style.transform = 'translate(-50%, -50%) rotate(-26deg) scale(1)';
                            } else if (flyT <= 0.50) {
                                const closeT = (flyT - 0.28) / 0.22;
                                const pScale = Math.max(0, 1 - Math.pow(closeT, 1.2));
                                portalExit.style.opacity = pScale > 0.02 ? '1' : '0';
                                portalExit.style.transform = `translate(-50%, -50%) rotate(-26deg) scale(${pScale.toFixed(3)})`;
                            } else {
                                portalExit.style.opacity = '0';
                                portalExit.style.transform = 'translate(-50%, -50%) rotate(-26deg) scale(0)';
                            }
                        }

                        // Emerging scale & opacity: crisp, solid, popping out of the void
                        orb.style.opacity = '1';
                        if (flyT < 0.12) {
                            const emergeT = flyT / 0.12;
                            totalScale = 1.35 * Math.sin(emergeT * Math.PI * 0.5);
                        } else {
                            totalScale = 1.35;
                        }

                        // 2-Segment Continuous Trajectory:
                        // Segment 1 (flyT <= 0.42): From Portal 2 through the arrow arch to Arrow Head
                        // Segment 2 (flyT > 0.42): Shoots down-right from Arrow Head straight to the Tech Icon
                        if (flyT <= 0.42) {
                            const u = flyT / 0.42;
                            const S0 = { x: pExitX, y: pExitY };
                            const S1 = { x: pApexX - 10, y: pApexY - 20 };
                            const S2 = { x: pHeadX - 40, y: pHeadY - 65 };
                            const S3 = { x: pHeadX, y: pHeadY };

                            const u1 = 1 - u;
                            const u1_2 = u1 * u1;
                            const u1_3 = u1_2 * u1;
                            const u_2 = u * u;
                            const u_3 = u_2 * u;
                            curX = u1_3 * S0.x + 3 * u1_2 * u * S1.x + 3 * u1 * u_2 * S2.x + u_3 * S3.x;
                            curY = u1_3 * S0.y + 3 * u1_2 * u * S1.y + 3 * u1 * u_2 * S2.y + u_3 * S3.y;

                            const flightStretch = Math.sin(u * Math.PI);
                            squashX = 1.0 - flightStretch * 0.10;
                            squashY = 1.0 + flightStretch * 0.14;
                        } else {
                            const v = (flyT - 0.42) / 0.58;
                            // Continuous streamline from arrow head directly to target tech icon
                            const dxFlight = finalLandingX - pHeadX;
                            const dyFlight = finalLandingY - pHeadY;
                            const T0 = { x: pHeadX, y: pHeadY };
                            const T1 = { x: pHeadX + dxFlight * 0.35, y: pHeadY + dyFlight * 0.35 };
                            const T2 = { x: pHeadX + dxFlight * 0.75, y: pHeadY + dyFlight * 0.75 };
                            const T3 = { x: finalLandingX, y: finalLandingY };

                            const v1 = 1 - v;
                            const v1_2 = v1 * v1;
                            const v1_3 = v1_2 * v1;
                            const v_2 = v * v;
                            const v_3 = v_2 * v;
                            curX = v1_3 * T0.x + 3 * v1_2 * v * T1.x + 3 * v1 * v_2 * T2.x + v_3 * T3.x;
                            curY = v1_3 * T0.y + 3 * v1_2 * v * T1.y + 3 * v1 * v_2 * T2.y + v_3 * T3.y;

                            if (v > 0.88) {
                                // Touchdown impact compression on the tech icon
                                const impactT = (v - 0.88) / 0.12;
                                const comp = Math.sin(impactT * Math.PI);
                                squashX = 1.0 + comp * 0.22;
                                squashY = 1.0 - comp * 0.18;
                            } else {
                                const flightStretch = Math.sin(v * Math.PI);
                                squashX = 1.0 - flightStretch * 0.08;
                                squashY = 1.0 + flightStretch * 0.12;
                            }
                        }

                        // Eyes remain facing forward towards the viewer / flight direction
                        setLiveOrbRoll(0, 0, 0);

                        // Dynamic airborne shadow
                        const flightApex = Math.sin(flyT * Math.PI);
                        shadowY = 6 + (1 - flightApex) * 6;
                        shadowBlur = 10 + flightApex * 14;
                        shadowAlpha = 0.35 - flightApex * 0.15;

                        // Once landed on the marquee, lock this landing spot as anchor!
                        if (flyT >= 0.98 && !isRidingMarquee) {
                            landingAnchorX = finalLandingX;
                            landingAnchorY = finalLandingY;
                            startAnchoredAtMarquee(finalLandingX, finalLandingY);
                        }
                    }

                    const scaleX = (totalScale * squashX).toFixed(3);
                    const scaleY = (totalScale * squashY).toFixed(3);
                    orb.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) scale(${scaleX}, ${scaleY})`;

                    if (box) {
                        const sY = typeof shadowY === 'number' ? shadowY.toFixed(1) : shadowY;
                        const sBlur = typeof shadowBlur === 'number' ? shadowBlur.toFixed(1) : shadowBlur;
                        const sAlpha = typeof shadowAlpha === 'number' ? shadowAlpha.toFixed(2) : shadowAlpha;
                        box.style.filter = `drop-shadow(0 ${sY}px ${sBlur}px rgba(0, 0, 0, ${sAlpha}))`;
                    }

                } else if (jumpProgress > 0.0001) {
                    // Phase 2: Roll forward 3 times along the closed laptop lid, scaling progressively, then plunge into black hole 1
                    const jt = Math.max(0, Math.min(1, jumpProgress));
                    let curX = p8x;
                    let curY = p8y;
                    let totalScale = 1.16;
                    let squashX = 1;
                    let squashY = 1;
                    let pitchAngle = 0;
                    let shadowY = 3;
                    let shadowBlur = 5;
                    let shadowAlpha = 0.40;

                    // Ensure exit portal is hidden during Phase 2
                    if (portalExit) {
                        portalExit.style.transform = 'translate(-50%, -50%) scale(0)';
                    }

                    if (jt <= 0.70) {
                        // Rolls 1, 2, and 3: Rolling in place across the closed laptop lid surface
                        // Progress normalized over the 3 surface rolls (0.0 to 1.0)
                        const rollProgress = jt / 0.70;

                        // 3 full 360-degree rotations forward (6π radians / 1080 degrees total)
                        pitchAngle = rollProgress * 3 * Math.PI * 2;

                        // Progressive perspective scaling on each roll: looks like it's coming to the front!
                        // Start: 1.16 | Roll 1: ~1.267 | Roll 2: ~1.373 | Roll 3: 1.480
                        totalScale = 1.16 + (rollProgress * 0.32);

                        // Do not move down! Keep bottom edge anchored squarely on top of the lid rim as it scales
                        curY = p8y - (totalScale - 1.16) * 21;

                        // Physical contact compression against the surface as it rolls
                        const rollCycle = Math.abs(Math.sin(pitchAngle));
                        squashY = 0.98 - 0.015 * rollCycle;
                        squashX = 1.02 + 0.015 * rollCycle;

                        // Crisp surface contact shadow resting on the lid
                        shadowY = 3;
                        shadowBlur = 5 + rollProgress * 3;
                        shadowAlpha = 0.40;

                        // Ground portal is wide open below laptop waiting for the ball to plunge
                        if (portalEntry) {
                            portalEntry.style.opacity = '1';
                            portalEntry.style.transform = 'translate(-50%, -50%) scale(1)';
                        }
                        if (box) {
                            box.style.opacity = '1';
                        }

                    } else {
                        // Roll 4: Tumbling off the lid and falling inside the dimensional ground portal!
                        const fallT = (jt - 0.70) / 0.30;

                        // 4th full 360-degree rotation (6π to 8π radians / 1080 to 1440 degrees) as it tumbles over the edge
                        pitchAngle = (3 * Math.PI * 2) + fallT * (Math.PI * 2);

                        // Freefall drop starting directly from the lid rim down to targetDropY (portal center)
                        const startFallY = p8y - (1.48 - 1.16) * 21;
                        // Target center of orb inside portal:
                        // Orb element is 42px tall, so orb center is curY + 21.
                        // Setting targetDropY = portalY - 21 aligns orb center dead-center in the portal hole!
                        const targetDropY = portalY - 21;

                        if (fallT <= 0.40) {
                            // Stage 2c-1: Tumble off lid lip toward open portal
                            const openT = fallT / 0.40;

                            if (portalEntry) {
                                portalEntry.style.opacity = '1';
                                portalEntry.style.transform = 'translate(-50%, -50%) scale(1)';
                            }

                            // Ball falls the first 40% of the distance
                            curY = startFallY + (targetDropY - startFallY) * Math.pow(openT, 1.8) * 0.40;
                            totalScale = 1.35;
                            squashY = 1.0 + openT * 0.12; // gravity stretch
                            squashX = 1.0 - openT * 0.08;

                            shadowY = 5 + openT * 12;
                            shadowBlur = 8 + openT * 10;
                            shadowAlpha = 0.40 - openT * 0.15;
                            if (box) box.style.opacity = '1';

                        } else if (fallT <= 0.76) {
                            // Stage 2c-2: Gravitational acceleration straight toward the open portal center
                            const accelT = (fallT - 0.40) / 0.36;

                            if (portalEntry) {
                                portalEntry.style.opacity = '1';
                                portalEntry.style.transform = 'translate(-50%, -50%) scale(1)';
                            }

                            const startY2 = startFallY + (targetDropY - startFallY) * 0.40;
                            curY = startY2 + (targetDropY - startY2) * Math.pow(accelT, 1.5);

                            // Gravitational tidal stretching into the portal void, tapering scale so bottom never crosses rim
                            squashY = 1.10 + accelT * 0.10;
                            squashX = 0.92 - accelT * 0.06;
                            totalScale = 1.35 - accelT * 0.35;

                            shadowY = 3;
                            shadowBlur = 6;
                            shadowAlpha = 0.25 * (1 - accelT);
                            if (box) box.style.opacity = '1';

                        } else {
                            // Stage 2c-3: FALLING INSIDE THE PORTAL!
                            const plungeT = (fallT - 0.76) / 0.24;

                            // Sinks smoothly right into singularity (dead-center of the portal hole)
                            curY = targetDropY;

                            // Singularity collapse: ball shrinks directly into the center of the black void
                            const shrink = Math.pow(1 - plungeT, 1.6);
                            totalScale = Math.max(0, 1.00 * shrink);
                            squashY = 1.0 + Math.sin(plungeT * Math.PI) * 0.12;
                            squashX = 1.0 - Math.sin(plungeT * Math.PI) * 0.08;

                            // Fades smoothly into the black void as it collapses
                            if (box) {
                                box.style.opacity = Math.max(0, 1 - Math.pow(plungeT, 1.6)).toFixed(2);
                            }

                            // Portal closes smoothly as ball is absorbed into singularity
                            if (portalEntry) {
                                if (plungeT > 0.35) {
                                    const closeP = (plungeT - 0.35) / 0.65;
                                    const pCloseScale = Math.max(0, 1 - Math.pow(closeP, 1.5));
                                    portalEntry.style.transform = `translate(-50%, -50%) scale(${pCloseScale.toFixed(3)})`;
                                    portalEntry.style.opacity = pCloseScale > 0.02 ? '1' : '0';
                                } else {
                                    portalEntry.style.opacity = '1';
                                    portalEntry.style.transform = 'translate(-50%, -50%) scale(1)';
                                }
                            }

                            shadowAlpha = 0;
                        }
                    }

                    // Send the true 3D spherical roll to the WebGL shader
                    setLiveOrbRoll(pitchAngle, 0, 0);

                    const scaleX = (totalScale * squashX).toFixed(3);
                    const scaleY = (totalScale * squashY).toFixed(3);

                    // Notice: NO CSS rotateX! The container remains a stable circle, while the 3D sphere rolls internally!
                    orb.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) scale(${scaleX}, ${scaleY})`;

                    // Dynamic shadow matching roll contact and freefall separation
                    if (box) {
                        const sY = typeof shadowY === 'number' ? shadowY.toFixed(1) : shadowY;
                        const sBlur = typeof shadowBlur === 'number' ? shadowBlur.toFixed(1) : shadowBlur;
                        const sAlpha = typeof shadowAlpha === 'number' ? shadowAlpha.toFixed(2) : shadowAlpha;
                        box.style.filter = `drop-shadow(0 ${sY}px ${sBlur}px rgba(0, 0, 0, ${sAlpha}))`;
                    }
                } else {
                    // Phase 1: Realistic Screen Glass Impact & Rebound to Closed Lid
                    // As laptop closes, orb is flung forward directly toward the user's screen -> smashes with realistic jelly wobble, frosted contact halo, refractive shockwave ripple, and camera thud -> bounces back to closed lid
                    const t = Math.max(0, Math.min(1, progress));

                    // Target smash point on user's screen:
                    // Flies along its natural launch vector from where it rested on open screen (p0x, p0y),
                    // down-forward into lower-middle viewport right against the screen glass
                    const smashX = p0x;
                    const smashY = Math.max((window.innerHeight || 850) * 0.44, Math.min((window.innerHeight || 850) * 0.54, p8y - 175));

                    let curX = p0x;
                    let curY = p0y;
                    let totalScale = 1.0;
                    let squashX = 1.0;
                    let squashY = 1.0;
                    let shadowFilter = '';

                    if (portalExit) {
                        portalExit.style.opacity = '0';
                        portalExit.style.transform = 'translate(-50%, -50%) rotate(-26deg) scale(0)';
                    }
                    if (box) box.style.opacity = '1';

                    // Portal 1 (entry hole below laptop):
                    // Opens smoothly as the ball touches down and settles onto the closed lid rim (t >= 0.84)
                    if (portalEntry) {
                        if (t >= 0.84) {
                            const pOpenT = (t - 0.84) / 0.16;
                            const pScale = Math.sin(pOpenT * Math.PI * 0.5);
                            portalEntry.style.opacity = '1';
                            portalEntry.style.transform = `translate(-50%, -50%) scale(${pScale.toFixed(3)})`;
                        } else {
                            portalEntry.style.opacity = '0';
                            portalEntry.style.transform = 'translate(-50%, -50%) scale(0)';
                        }
                    }

                    if (t <= 0.40) {
                        // Stage 1a: Forward and downward momentum from swinging lid hurtling into camera
                        const launchT = t / 0.40;
                        const easedLaunch = Math.pow(launchT, 1.4);

                        // Direct trajectory along rotational momentum + gravity towards the screen
                        curX = p0x + (smashX - p0x) * easedLaunch;
                        curY = p0y + (smashY - p0y) * easedLaunch;

                        // Massive 3D perspective growth: balloons up from 1.0 to 5.6x toward camera
                        totalScale = 1.0 + Math.pow(launchT, 1.4) * 4.6;

                        // Maintains circular spherical profile during flight
                        squashX = 1.0;
                        squashY = 1.0;

                        // Tumbles forward in true 3D as it hurtles toward viewer
                        setLiveOrbRoll(launchT * Math.PI * 0.9, 0, 0);

                        // Background shadow softens and fades as distance from laptop increases
                        const shadowBlur = (8 + launchT * 40).toFixed(1);
                        const shadowAlpha = (0.26 * (1 - launchT * 0.75)).toFixed(2);
                        shadowFilter = `drop-shadow(0 10px ${shadowBlur}px rgba(0, 0, 0, ${shadowAlpha}))`;

                        // Reset impact overlay & screen shake
                        if (impactOverlay) impactOverlay.style.opacity = '0';
                        if (shockwave) shockwave.style.opacity = '0';
                        hero.style.transform = '';

                    } else if (t <= 0.58) {
                        // Stage 1b: Realistic Screen Glass Impact & Radial Jelly Splat!
                        // The ball hits the viewport glass perpendicularly.
                        // In the (X, Y) plane of the screen, it spreads radially (circular disc) with high-speed organic jelly ripple.
                        const splatT = (t - 0.40) / 0.18;
                        const splatIntensity = Math.sin(splatT * Math.PI);

                        // Radial pancake expansion: expands outward in all directions against the glass (5.6x -> 7.2x)
                        totalScale = 5.6 + splatIntensity * 1.6;

                        // Organic high-frequency jelly wobble upon glass contact
                        const jellyWobble = Math.sin(splatT * Math.PI * 6) * 0.05 * splatIntensity;
                        squashX = 1.0 + jellyWobble;
                        squashY = 1.0 - jellyWobble;

                        // High-speed collision micro-jitter
                        const jitterX = Math.sin(splatT * Math.PI * 16) * 3.5 * splatIntensity;
                        const jitterY = Math.cos(splatT * Math.PI * 16) * 3.5 * splatIntensity;
                        curX = smashX + jitterX;
                        curY = smashY + jitterY;

                        // Pressed flat against screen, looking straight ahead into viewer's eyes
                        setLiveOrbRoll(0, 0, 0);

                        // Frosted white contact glow halo + deep ambient depth shadow
                        const whiteGlow = (0.45 + splatIntensity * 0.45).toFixed(2);
                        const glassBlur = (28 + splatIntensity * 38).toFixed(1);
                        const depthBlur = (25 + splatIntensity * 30).toFixed(1);
                        const depthAlpha = (0.22 + splatIntensity * 0.14).toFixed(2);
                        shadowFilter = `drop-shadow(0 0 ${glassBlur}px rgba(255, 255, 255, ${whiteGlow})) drop-shadow(0 16px ${depthBlur}px rgba(0, 0, 0, ${depthAlpha}))`;

                        // Expanding circular refractive shockwave ripple on the screen (centered on the orb)
                        if (impactOverlay) {
                            impactOverlay.style.left = `${smashX + 21}px`;
                            impactOverlay.style.top = `${smashY + 21}px`;
                            impactOverlay.style.opacity = '1';

                            if (shockwave) {
                                const swScale = (0.3 + splatT * 2.2).toFixed(2);
                                shockwave.style.transform = `translate(-50%, -50%) scale(${swScale})`;
                                shockwave.style.opacity = (splatIntensity * 0.85).toFixed(2);
                            }
                        }

                        // Crisp physical viewport camera thud
                        const shakeMag = Math.pow(splatIntensity, 2) * 7.5;
                        const shakeY = Math.sin(splatT * Math.PI * 12) * shakeMag;
                        const shakeX = Math.cos(splatT * Math.PI * 8) * (shakeMag * 0.4);
                        hero.style.transform = `translate3d(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px, 0)`;

                    } else {
                        // Stage 1c: Rebound off the glass & parabolic 3D bounce back to closed lid (p8x, p8y)
                        const reboundT = (t - 0.58) / 0.42;

                        // Reset screen impact overlay & shockwave from Stage 1b
                        if (impactOverlay) impactOverlay.style.opacity = '0';
                        if (shockwave) shockwave.style.opacity = '0';

                        if (reboundT <= 0.74) {
                            // Stage 1c-1: 3D Parabolic Flight through air to closed lid rim (p8x, p8y)
                            const flightT = reboundT / 0.74;

                            // Smooth horizontal motion from smashX to p8x
                            const easeX = flightT * flightT * (3 - 2 * flightT);
                            curX = smashX + (p8x - smashX) * easeX;

                            // Parabolic gravity bounce curve reaching lid rim at flightT = 1.0
                            const apexLift = Math.sin(flightT * Math.PI) * 45;
                            const baseY = smashY + (p8y - smashY) * (flightT * flightT);
                            curY = baseY - apexLift;

                            // Shrinks back from 5.6 down to 1.16 as it recedes into depth
                            totalScale = 5.6 - (5.6 - 1.16) * Math.pow(flightT, 0.75);

                            // Elastic recoil right after peeling off screen glass, then returns to round sphere in flight
                            if (flightT < 0.28) {
                                const recoil = Math.sin((flightT / 0.28) * Math.PI);
                                squashY = 1.0 + recoil * 0.16;
                                squashX = 1.0 - recoil * 0.10;
                            } else {
                                squashX = 1.0;
                                squashY = 1.0;
                            }

                            // Rebound rotation settling as it arcs back
                            const reboundRoll = (1 - flightT) * Math.PI * 0.8;
                            setLiveOrbRoll(reboundRoll, 0, 0);

                            // Softening airborne shadow dropping toward lid
                            const shadowY = (18 - flightT * 14).toFixed(1);
                            const shadowBlur = (30 - flightT * 22).toFixed(1);
                            const shadowAlpha = (0.12 + flightT * 0.26).toFixed(2);
                            shadowFilter = `drop-shadow(0 ${shadowY}px ${shadowBlur}px rgba(0, 0, 0, ${shadowAlpha}))`;
                            hero.style.transform = '';

                        } else {
                            // Stage 1c-2: High-impact touchdown & strike on the metallic laptop lid!
                            const impactT = (reboundT - 0.74) / 0.26;
                            curX = p8x;
                            totalScale = 1.16;
                            setLiveOrbRoll(0, 0, 0);

                            if (impactT <= 0.46) {
                                // Surface impact compression: ball flattens against the hard horizontal lid
                                const compT = impactT / 0.46;
                                const compFactor = Math.sin(compT * Math.PI);

                                // Pancake squash: expands horizontally up to 1.36x, compresses down to 0.72x
                                squashX = 1.0 + compFactor * 0.36;
                                squashY = 1.0 - compFactor * 0.28;

                                // Pin the flattened bottom edge against the metallic lid surface
                                const contactOffset = (1.0 - squashY) * 21 * totalScale;
                                curY = p8y + contactOffset;

                                // Surface contact shadow expands wide and dark upon impact
                                const sBlur = (8 - compFactor * 4).toFixed(1);
                                const sY = (4 - compFactor * 2).toFixed(1);
                                const sAlpha = (0.40 + compFactor * 0.38).toFixed(2);
                                shadowFilter = `drop-shadow(0 ${sY}px ${sBlur}px rgba(0, 0, 0, ${sAlpha}))`;

                                // Physical metallic impact vibration on laptop
                                const thudMag = Math.sin(compT * Math.PI * 2) * (1 - compT) * 2.5;
                                hero.style.transform = `translate3d(0, ${thudMag.toFixed(1)}px, 0)`;

                            } else if (impactT <= 0.82) {
                                // Elastic micro-rebound: pops up slightly from stored kinetic energy
                                const bounceT = (impactT - 0.46) / 0.36;
                                const bounceLift = Math.sin(bounceT * Math.PI) * 9;
                                curY = p8y - bounceLift;

                                // Slight aerodynamic elongation during the hop
                                const stretch = Math.sin(bounceT * Math.PI);
                                squashY = 1.0 + stretch * 0.12;
                                squashX = 1.0 - stretch * 0.08;

                                const sBlur = (6 + bounceLift * 1.2).toFixed(1);
                                const sY = (3 + bounceLift * 0.6).toFixed(1);
                                const sAlpha = (0.44 - (bounceLift / 9) * 0.12).toFixed(2);
                                shadowFilter = `drop-shadow(0 ${sY}px ${sBlur}px rgba(0, 0, 0, ${sAlpha}))`;
                                hero.style.transform = '';

                            } else {
                                // Settles firmly onto the lid, perfectly round and ready to roll
                                const settleT = (impactT - 0.82) / 0.18;
                                const settleFactor = Math.sin(settleT * Math.PI);
                                squashX = 1.0 + settleFactor * 0.04;
                                squashY = 1.0 - settleFactor * 0.03;
                                curY = p8y + (1.0 - squashY) * 21 * totalScale;
                                shadowFilter = `drop-shadow(0 3px 5px rgba(0, 0, 0, 0.40))`;
                                hero.style.transform = '';
                            }
                        }
                    }

                    const scaleX = (totalScale * squashX).toFixed(3);
                    const scaleY = (totalScale * squashY).toFixed(3);

                    orb.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) scale(${scaleX}, ${scaleY})`;
                    if (box) {
                        box.style.filter = shadowFilter;
                    }
                }
        };

            window.addEventListener('resize', () => {
                if (typeof currentProgress !== 'undefined') {
                    updateOrbPath(currentProgress, currentJump || 0, currentTravel || 0, currentProjects || 0);
                }
            });

            const updateAnimation = () => {
                const diff = targetProgress - currentProgress;

                if (!introComplete) {
                    currentProgress += diff * 0.04;
                } else if (targetProgress === 0) {
                    // Scrolling back up to top: smoothly unhinge laptop and return orb to screen
                    currentProgress += diff * 0.22;
                    if (Math.abs(diff) < 0.005) currentProgress = 0;
                } else {
                    // targetProgress === 1: autonomous playback to closed lid
                    // Even on fast scroll, this sequence is NEVER skipped!
                    // Scale step dynamically with scroll speed so it is responsive yet fully visible (~420ms to 900ms)
                    const fastFactor = Math.min(1.0, Math.max(0, (lastScrollPos - 20) / 400));
                    const step = 0.018 + fastFactor * 0.018; // 0.018 (~55 frames = ~900ms) to 0.036 (~28 frames = ~450ms)
                    currentProgress = Math.min(1.0, currentProgress + step);
                }

                // Sequential State-Gating:
                // Phase 2 (3 rolls across lid & plunge into black hole 1) starts once Phase 1 has finished landing on the lid!
                const effectiveTargetJump = currentProgress >= 0.96 ? targetJump : 0;
                const jumpDiff = effectiveTargetJump - currentJump;
                const absJumpDiff = Math.abs(jumpDiff);
                if (absJumpDiff > 0.0001) {
                    const fastJumpFactor = Math.min(1.0, Math.max(0, (lastScrollPos - 40) / 400));
                    const maxJumpStep = jumpDiff < 0 ? 0.06 : (0.020 + fastJumpFactor * 0.016);
                    const jumpStep = Math.sign(jumpDiff) * Math.min(absJumpDiff, Math.max(0.014, Math.min(maxJumpStep, absJumpDiff * 0.22)));
                    currentJump += jumpStep;
                } else {
                    currentJump = effectiveTargetJump;
                }

                // Phase 3 (emerge from hole 2 at arrow & arc to marquee icon) only starts once Phase 2 has fallen into hole 1!
                const effectiveTargetTravel = (currentProgress >= 0.999 && currentJump >= 0.999) ? targetTravel : 0;
                const travelDiff = effectiveTargetTravel - currentTravel;
                const absTravelDiff = Math.abs(travelDiff);
                if (absTravelDiff > 0.0001) {
                    // Natural dynamic speed curve: brisk, natural projectile speed
                    const stepSize = currentTravel < 0.18 ? 0.022 : 0.036;
                    const travelStep = travelDiff < 0 
                        ? -Math.min(absTravelDiff, 0.06) 
                        : Math.min(absTravelDiff, stepSize);
                    currentTravel += travelStep;
                } else {
                    currentTravel = effectiveTargetTravel;
                }

                // Phase 4 (projects gap) only starts once Phase 3 has arrived at the portrait!
                const effectiveTargetProjects = (currentProgress >= 0.999 && currentJump >= 0.999 && currentTravel >= 0.999) ? targetProjects : 0;
                const projDiff = effectiveTargetProjects - currentProjects;
                const absProjDiff = Math.abs(projDiff);
                if (absProjDiff > 0.0001) {
                    const maxProjStep = projDiff < 0 ? 0.06 : 0.036;
                    const projStep = Math.sign(projDiff) * Math.min(absProjDiff, Math.max(0.015, Math.min(maxProjStep, absProjDiff * 0.22)));
                    currentProjects += projStep;
                } else {
                    currentProjects = effectiveTargetProjects;
                }

                // Synchronize laptop opening:
                // Laptop is fully flat & closed for progress >= 0.50 (orb smashes on screen at 0.50, then rebounds to closed lid by 1.0)
                // When scrolling up, laptop unhinges open as orb returns to open screen (progress < 0.50)
                const laptopProgress = Math.max(0, Math.min(1, currentProgress / 0.50));

                laptopBlock.style.transform = `translate3d(0, 0, 0) rotateY(-${laptopProgress * 90}deg)`;
                if (!isRidingMarquee || currentProjects > 0.0001) {
                    updateOrbPath(currentProgress, currentJump, currentTravel, currentProjects);
                } else {
                    ensureLoopRunning();
                }

                if (laptopProgress >= 0.99) {
                    // Fully closed: hide the block and reveal the flat lid
                    laptopBlock.style.visibility = 'hidden';
                    laptopBlock.style.opacity = '0';
                    if (screenContent) screenContent.style.visibility = 'hidden';

                    laptopTop.style.opacity = 1;
                    laptopTop.style.transform = 'scale(1)';
                    laptopTop.style.top = '0px';
                    laptopTop.style.left = '20px';
                    laptopTop.style.zIndex = 0;
                    laptopBlock.classList.remove('glare-active');
                } else {
                    // Opening / still open: reveal screen block
                    laptopBlock.style.visibility = 'visible';
                    laptopBlock.style.opacity = '1';
                    laptopTop.style.opacity = 0;
                    laptopTop.style.zIndex = -5;
                    if (screenContent) screenContent.style.visibility = 'visible';

                    if (laptopProgress > 0.01) {
                        laptopBlock.classList.add('glare-active');
                        const glareX = -150 + (laptopProgress * 300);
                        const glareY = -150 + (laptopProgress * 300);
                        laptopBlock.style.setProperty('--glare-pos', `${glareX}% ${glareY}%`);
                    } else {
                        laptopBlock.classList.remove('glare-active');
                    }
                }

                const hasProgressSettled = Math.abs(targetProgress - currentProgress) <= 0.0001;
                const hasJumpSettled = Math.abs(effectiveTargetJump - currentJump) <= 0.0001;
                const hasTravelSettled = Math.abs(effectiveTargetTravel - currentTravel) <= 0.0001;
                const hasProjectsSettled = Math.abs(effectiveTargetProjects - currentProjects) <= 0.0001;

                if (!hasProgressSettled || !hasJumpSettled || !hasTravelSettled || !hasProjectsSettled || isOrbClimbWalking || isOrbVortexSucking) {
                    laptop.classList.remove('laptop--opened');
                    rafId = requestAnimationFrame(updateAnimation);
                } else {
                    currentProgress = targetProgress;
                    currentJump = effectiveTargetJump;
                    currentTravel = effectiveTargetTravel;
                    currentProjects = effectiveTargetProjects;
                    rafId = null;
                    // Once the intro open animation reaches 0, mark it done & enable scroll
                    if (!introComplete && targetProgress === 0) {
                        introComplete = true;
                        updateOrbPath(0, 0, 0);
                        revealLiveOrb();
                    }
                    if (currentProgress === 0) {
                        laptop.classList.add('laptop--opened');
                    } else {
                        laptop.classList.remove('laptop--opened');
                    }
                }
            };

            window.wakeOrbAnimation = () => {
                if (!rafId) {
                    rafId = requestAnimationFrame(updateAnimation);
                }
            };

            const handleScroll = () => {
                revealLiveOrb();
                if (!introComplete) {
                    introComplete = true;
                }
                const scrollPos = (lenis && typeof lenis.scroll === 'number') ? lenis.scroll : (window.pageYOffset || document.documentElement.scrollTop || 0);
                lastScrollPos = scrollPos;

                if (scrollPos < 60 && isRidingMarquee) {
                    stopRidingMarquee();
                }

                // Phase 1: As laptop lid closes, the ball bounces to the center of the lid
                if (scrollPos <= 20) {
                    targetProgress = 0;
                    targetJump = 0;
                    targetTravel = 0;
                } else {
                    targetProgress = 1;
                }

                // Phase 2: Scroll past laptop close activates Phase 2 (rolls across lid and into black hole 1)
                if (scrollPos > 40) {
                    targetJump = 1;
                } else {
                    targetJump = 0;
                }

                // Phase 3: Emerge from hole 2 at arrow tail, shoot along arrow and land on marquee
                if (scrollPos > 120) {
                    targetTravel = 1;
                } else if (scrollPos <= 40) {
                    targetTravel = 0;
                }

                // Phase 4: Scroll through Selected Projects & Experience down to Running Marquee
                const projectsSec = document.getElementById('projects');
                const expSec = document.getElementById('experience');
                const marqueeEl = document.querySelector('.marquee-container') || document.getElementById('marquee-track-1');
                let pStart = 1350;
                let pRange = 2200;
                if (projectsSec) {
                    const curY = (lenis && typeof lenis.scroll === 'number') ? lenis.scroll : (window.pageYOffset || document.documentElement.scrollTop || 0);
                    const pRect = projectsSec.getBoundingClientRect();
                    const pDocTop = pRect.top + curY;
                    pStart = Math.max(1200, pDocTop - 420);

                    if (marqueeEl) {
                        const mRect = marqueeEl.getBoundingClientRect();
                        const mDocTop = mRect.top + curY;
                        const winH = window.innerHeight || 850;
                        const pEnd = mDocTop - Math.max(220, winH * 0.35);
                        pRange = Math.max(1600, pEnd - pStart);
                    } else if (expSec) {
                        const eRect = expSec.getBoundingClientRect();
                        const eDocTop = eRect.top + curY;
                        pRange = Math.max(1200, (eDocTop - pStart) + 400);
                    } else {
                        pRange = Math.max(1200, (projectsSec.offsetHeight || 1400) + 600);
                    }
                }

                if (scrollPos > pStart) {
                    targetProjects = Math.max(0, Math.min(1, (scrollPos - pStart) / pRange));
                } else {
                    targetProjects = 0;
                }

                if (scrollPos > pStart + 50 && isRidingMarquee) {
                    stopRidingMarquee();
                }

                if (targetProgress > 0) {
                    laptop.classList.remove('laptop--opened');
                }
                if (!rafId) {
                    rafId = requestAnimationFrame(updateAnimation);
                }
            };

            if (lenis) {
                lenis.on('scroll', handleScroll);
            }
            window.wakeOrbAnimation = () => {
                if (!rafId) {
                    rafId = requestAnimationFrame(updateAnimation);
                }
            };

            window.addEventListener('scroll', handleScroll, { passive: true });
            document.addEventListener('scroll', handleScroll, { passive: true });

            // Paint the closed state immediately so the lid is visible
            updateAnimation();

            revealLiveOrb = () => {
                const orb = document.getElementById('live-orb-mascot');
                if (orb) {
                    if (typeof updateOrbPath === 'function') {
                        updateOrbPath(currentProgress || 0, currentJump || 0, currentTravel || 0, currentProjects || 0);
                    }
                    orb.classList.add('orb-visible');
                }
            };


            const getSortedMarqueeItems = () => {
                const items = Array.from(document.querySelectorAll('.logo-loop-item')).filter(it => {
                    const r = it.getBoundingClientRect();
                    return r.width > 0 && r.left > -200 && r.right < window.innerWidth + 200;
                });
                items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
                return items;
            };

            const getNextMarqueeItem = (currentItem) => {
                if (!currentItem) return null;
                const curLeft = currentItem.getBoundingClientRect();
                const items = getSortedMarqueeItems();
                return items.find(it => it !== currentItem && it.getBoundingClientRect().left > curLeft.left + 15) || null;
            };

            const getPrevMarqueeItem = (currentItem) => {
                if (!currentItem) return null;
                const curLeft = currentItem.getBoundingClientRect();
                const items = getSortedMarqueeItems();
                const leftItems = items.filter(it => it !== currentItem && it.getBoundingClientRect().left < curLeft.left - 15);
                return leftItems.length > 0 ? leftItems[leftItems.length - 1] : null;
            };

            const performSingleHopTo = (targetItem, duration = 320) => {
                const orb = document.getElementById('live-orb-mascot');
                const hero = document.getElementById('desktop-hero');
                if (!orb || !hero || !targetItem) return;

                revealLiveOrb();
                document.querySelectorAll('.logo-loop-item.orb-riding').forEach(el => el.classList.remove('orb-riding'));
                targetItem.classList.add('orb-riding');

                const img = targetItem.querySelector('img');
                ridingAlt = img ? (img.getAttribute('alt') || img.src) : '';

                const orbRect = orb.getBoundingClientRect();
                const heroRect = hero.getBoundingClientRect();
                hopFromX = orbRect.left - heroRect.left;
                hopFromY = orbRect.top - heroRect.top;

                ridingItem = targetItem;
                lastKnownX = targetItem.getBoundingClientRect().left;

                currentHopDuration = duration;
                hopStartTime = performance.now();

                isRidingMarquee = true;
                ensureLoopRunning();
            };

            const startStepTowardsGoal = () => {
                if (!finalGoalItem) return;
                const orb = document.getElementById('live-orb-mascot');
                const hero = document.getElementById('desktop-hero');
                if (!orb || !hero) return;

                const items = getSortedMarqueeItems();
                if (items.length === 0) {
                    finalGoalItem = null;
                    return;
                }

                if (!ridingItem) {
                    const orbRect = orb.getBoundingClientRect();
                    let closest = items[0];
                    let minD = Infinity;
                    items.forEach(it => {
                        const d = Math.abs(it.getBoundingClientRect().left - orbRect.left);
                        if (d < minD) { minD = d; closest = it; }
                    });
                    ridingItem = closest;
                }

                const curRect = ridingItem.getBoundingClientRect();
                const goalRect = finalGoalItem.getBoundingClientRect();

                // Reached the goal?
                if (ridingItem === finalGoalItem || Math.abs(goalRect.left - curRect.left) < 18) {
                    finalGoalItem = null;
                    return;
                }

                let curIdx = items.indexOf(ridingItem);
                if (curIdx === -1) {
                    let minD = Infinity;
                    items.forEach((it, idx) => {
                        const d = Math.abs(it.getBoundingClientRect().left - curRect.left);
                        if (d < minD) { minD = d; curIdx = idx; }
                    });
                }

                let goalIdx = items.indexOf(finalGoalItem);
                if (goalIdx === -1) {
                    let minD = Infinity;
                    items.forEach((it, idx) => {
                        const d = Math.abs(it.getBoundingClientRect().left - goalRect.left);
                        if (d < minD) { minD = d; goalIdx = idx; }
                    });
                }

                let nextItem = null;
                if (goalIdx > curIdx && curIdx + 1 < items.length) {
                    nextItem = items[curIdx + 1];
                } else if (goalIdx < curIdx && curIdx - 1 >= 0) {
                    nextItem = items[curIdx - 1];
                } else {
                    nextItem = goalRect.left > curRect.left ? items[curIdx + 1] : items[curIdx - 1];
                }

                if (!nextItem || nextItem === ridingItem) {
                    finalGoalItem = null;
                    return;
                }

                performSingleHopTo(nextItem, 320);
            };

            const hopToIcon = (targetIcon) => {
                if (targetIcon) handleMarqueeItemClick(targetIcon);
            };

            const hopToNeighbor = (neighborItem) => {
                if (neighborItem) performSingleHopTo(neighborItem, 340);
            };

            startAnchoredAtMarquee = (ax, ay) => {
                const orb = document.getElementById('live-orb-mascot');
                const hero = document.getElementById('desktop-hero');
                if (!orb || !hero) return;

                isRidingMarquee = true;
                revealLiveOrb();

                // Find the marquee item currently closest to ax
                const heroRect = hero.getBoundingClientRect();
                const items = getSortedMarqueeItems();
                if (items.length > 0) {
                    let closest = items[0];
                    let minD = Infinity;
                    items.forEach(it => {
                        const r = it.getBoundingClientRect();
                        const cx = (r.left + r.width * 0.5) - heroRect.left - 21;
                        const d = Math.abs(cx - ax);
                        if (d < minD) { minD = d; closest = it; }
                    });
                    ridingItem = closest;
                    const img = closest.querySelector('img');
                    ridingAlt = img ? (img.getAttribute('alt') || img.src) : '';
                    document.querySelectorAll('.logo-loop-item.orb-riding').forEach(el => el.classList.remove('orb-riding'));
                    closest.classList.add('orb-riding');
                    const targetX = (closest.getBoundingClientRect().left + closest.getBoundingClientRect().width * 0.5) - heroRect.left - 21;
                    const targetY = (closest.getBoundingClientRect().top - heroRect.top) - 40;
                    orb.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0) rotateZ(0deg) scale(1.22)`;
                    hopStartTime = performance.now() - 1000;
                    currentHopDuration = 0;
                } else {
                    orb.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0) rotateZ(0deg) scale(1.22)`;
                }
                const box = orb.querySelector('.live-orb-box');
                if (box) box.style.filter = 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.16))';

                ensureLoopRunning();
            };

            handleMarqueeItemClick = (clickedItem) => {
                if (!clickedItem) return;
                revealLiveOrb();

                // If not currently in marquee mode, start riding on clicked item
                if (!isRidingMarquee) {
                    startRidingMarquee(clickedItem, true);
                    return;
                }

                // If clicked item is already the current active item, do a cute jump in place
                if (ridingItem === clickedItem) {
                    performSingleHopTo(clickedItem, 320);
                    finalGoalItem = null;
                    return;
                }

                // Sequential hopping towards the clicked target icon!
                finalGoalItem = clickedItem;
                startStepTowardsGoal();
            };

            let ridingRafId = null;
            const ridingLoop = (timestamp) => {
                if (!isRidingMarquee) {
                    ridingRafId = null;
                    return;
                }
                updateRidingOrb(timestamp);
                ridingRafId = requestAnimationFrame(ridingLoop);
            };

            ensureLoopRunning = () => {
                if (!ridingRafId) {
                    ridingRafId = requestAnimationFrame(ridingLoop);
                }
            };

            startRidingMarquee = (item, immediate = false) => {
                const orb = document.getElementById('live-orb-mascot');
                const hero = document.getElementById('desktop-hero');
                if (!orb || !hero || !item) return;

                isRidingMarquee = true;
                revealLiveOrb();

                // Remove highlight from previous item
                document.querySelectorAll('.logo-loop-item.orb-riding').forEach(el => el.classList.remove('orb-riding'));

                const img = item.querySelector('img');
                ridingAlt = img ? (img.getAttribute('alt') || img.src) : '';
                ridingItem = item;
                ridingItem.classList.add('orb-riding');

                const itemRect = item.getBoundingClientRect();
                const heroRect = hero.getBoundingClientRect();
                lastKnownX = itemRect.left;

                const targetX = (itemRect.left + itemRect.width * 0.5) - heroRect.left - 21;
                const targetY = (itemRect.top - heroRect.top) - 40; // Perched flush on top rim of icon

                if (immediate) {
                    hopFromX = targetX;
                    hopFromY = targetY;
                    currentHopDuration = 0;
                    hopStartTime = performance.now() - 1000;
                    orb.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0) rotateZ(0deg) scale(1.22)`;
                    const box = orb.querySelector('.live-orb-box');
                    if (box) box.style.filter = 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.16))';
                } else {
                    const orbRect = orb.getBoundingClientRect();
                    hopFromX = orbRect.left - heroRect.left;
                    hopFromY = orbRect.top - heroRect.top;
                    const dist = Math.hypot(targetX - hopFromX, targetY - hopFromY);
                    currentHopDuration = Math.min(600, Math.max(380, dist * 0.75));
                    hopStartTime = performance.now();
                }

                isRidingMarquee = true;
                ensureLoopRunning();
            };

            stopRidingMarquee = () => {
                if (!isRidingMarquee) return;
                isRidingMarquee = false;
                if (ridingRafId) {
                    cancelAnimationFrame(ridingRafId);
                    ridingRafId = null;
                }
                ridingAlt = '';
                lastKnownX = null;
                finalGoalItem = null;
                if (ridingItem) {
                    ridingItem.classList.remove('orb-riding');
                    ridingItem = null;
                }
                document.querySelectorAll('.logo-loop-item.orb-riding').forEach(el => el.classList.remove('orb-riding'));
                if (!rafId) {
                    rafId = requestAnimationFrame(updateAnimation);
                }
            };

            updateRidingOrb = (timestamp) => {
                const orb = document.getElementById('live-orb-mascot');
                const hero = document.getElementById('desktop-hero');
                if (!orb || !hero || !isRidingMarquee) return;

                const box = orb.querySelector('.live-orb-box');

                if (!ridingItem || !ridingItem.isConnected) {
                    const items = getSortedMarqueeItems();
                    if (items.length === 0) return;
                    ridingItem = items[0];
                    ridingItem.classList.add('orb-riding');
                    const img = ridingItem.querySelector('img');
                    ridingAlt = img ? (img.getAttribute('alt') || img.src) : '';
                }

                let itemRect = ridingItem.getBoundingClientRect();

                // Seamless Marquee Wrap Protection:
                // When the infinite marquee wraps around (offset = offset % seqWidth),
                // the DOM track shifts right by +seqWidth (~896px).
                // If ridingItem shifts right by > 300px in a single frame, immediately re-bind
                // ridingItem to the identical clone that just moved into its exact screen position!
                if (lastKnownX !== null && (itemRect.left - lastKnownX) > 300) {
                    const allItems = Array.from(document.querySelectorAll('.logo-loop-item'));
                    let bestMatch = ridingItem;
                    let minDiff = Infinity;
                    allItems.forEach(it => {
                        const diff = Math.abs(it.getBoundingClientRect().left - lastKnownX);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestMatch = it;
                        }
                    });
                    if (bestMatch && bestMatch !== ridingItem) {
                        ridingItem.classList.remove('orb-riding');
                        ridingItem = bestMatch;
                        ridingItem.classList.add('orb-riding');
                        const img = ridingItem.querySelector('img');
                        ridingAlt = img ? (img.getAttribute('alt') || img.src) : '';
                        itemRect = ridingItem.getBoundingClientRect();
                    }
                }
                lastKnownX = itemRect.left;

                if (finalGoalItem && lastGoalX !== null) {
                    const gRect = finalGoalItem.getBoundingClientRect();
                    if ((gRect.left - lastGoalX) > 300) {
                        const allItems = Array.from(document.querySelectorAll('.logo-loop-item'));
                        let bestGoal = finalGoalItem;
                        let minDiff = Infinity;
                        allItems.forEach(it => {
                            const diff = Math.abs(it.getBoundingClientRect().left - lastGoalX);
                            if (diff < minDiff) {
                                minDiff = diff;
                                bestGoal = it;
                            }
                        });
                        finalGoalItem = bestGoal;
                    }
                }
                if (finalGoalItem) {
                    lastGoalX = finalGoalItem.getBoundingClientRect().left;
                } else {
                    lastGoalX = null;
                }
                const heroRect = hero.getBoundingClientRect();
                const itemCenterX = (itemRect.left + itemRect.width * 0.5) - heroRect.left;
                const itemTopY = (itemRect.top - heroRect.top);

                const destX = itemCenterX - 21;
                const destY = itemTopY - 40; // Perched flush on top rim of the icon

                const elapsed = timestamp - hopStartTime;
                const ht = Math.min(1, Math.max(0, elapsed / currentHopDuration));

                let curX, curY, scale, rotZ;

                if (ht < 1) {
                    // Parabolic leap over to the current target icon
                    const parabola = 4 * ht * (1 - ht);
                    const hopLift = parabola * 42;
                    curX = hopFromX + (destX - hopFromX) * ht;
                    curY = (hopFromY + (destY - hopFromY) * ht) - hopLift;

                    const dirX = Math.sign(destX - hopFromX) || 1;
                    rotZ = Math.sin(ht * Math.PI) * (dirX * 12);
                    scale = 1.22 + Math.sin(ht * Math.PI) * 0.14;

                    if (box) {
                        const shadowY = (8 + parabola * 16).toFixed(1);
                        const shadowBlur = (10 + parabola * 18).toFixed(1);
                        const shadowAlpha = (0.24 - parabola * 0.10).toFixed(2);
                        box.style.filter = `drop-shadow(0 ${shadowY}px ${shadowBlur}px rgba(0, 0, 0, ${shadowAlpha}))`;
                    }
                } else {
                    // Landed squarely on ridingItem!
                    curX = destX;
                    curY = destY;
                    rotZ = 0;
                    scale = 1.22;

                    if (box) {
                        box.style.filter = 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.16))';
                    }

                    // If user clicked an icon, take the step-by-step hops towards it
                    if (finalGoalItem) {
                        const curRect = ridingItem.getBoundingClientRect();
                        const goalRect = finalGoalItem.getBoundingClientRect();

                        // Reached final goal?
                        if (ridingItem === finalGoalItem || Math.abs(goalRect.left - curRect.left) < 18) {
                            finalGoalItem = null;
                        } else {
                            startStepTowardsGoal();
                        }
                    } else {
                        // Check if current icon has reached the end (left boundary)
                        const loop = document.getElementById('logo-loop');
                        const loopRect = loop ? loop.getBoundingClientRect() : { left: 0, width: window.innerWidth };
                        const endThreshold = loopRect.left + Math.max(70, loopRect.width * 0.08);

                        if (itemRect.left <= endThreshold) {
                            // Reached the end! Jump to the next icon (to its right on track)
                            const nextItem = getNextMarqueeItem(ridingItem);
                            if (nextItem && nextItem !== ridingItem) {
                                performSingleHopTo(nextItem, 340);
                            }
                        } else {
                            // Idle ride with gentle breathing bob
                            const rideTime = timestamp * 0.005;
                            const subtleBob = Math.sin(rideTime) * 1.5;
                            curY = destY + subtleBob;
                            rotZ = Math.sin(rideTime * 0.5) * 1.5;
                        }
                    }
                }

                orb.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) rotateZ(${rotZ.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
            };

            // Stay closed for 1 second, then smoothly open
            setTimeout(() => {
                targetProgress = 0; // Animate to fully open
                targetJump = 0;
                targetTravel = 0;
                if (!rafId) rafId = requestAnimationFrame(updateAnimation);
            }, 1400);
        }

    // 1b. Apple "Hello" Boot Effect (Cursive handwriting on laptop screen + macOS Unlock Curtain)
    const initLaptopHello = () => {
        const overlay = document.getElementById('laptop-hello-overlay');
        if (!overlay) return;

        // Trigger handwriting animation as laptop begins to rotate open
        setTimeout(() => {
            overlay.classList.add('writing');
        }, 1600);

        // When writing finishes, slide up like a macOS lock screen curtain to reveal portfolio
        setTimeout(() => {
            overlay.classList.add('curtain-up');
            revealLiveOrb();
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 900);
        }, 4700);

        // Safety guarantee: Ensure orb is revealed after curtain sequence even if delayed
        setTimeout(() => {
            revealLiveOrb();
        }, 4900);
    };
    initLaptopHello();

    // 2. Reveal Up Observer
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal-up').forEach(el => revealObserver.observe(el));

    // 2b. Mobile Envelope Auto-Open on Scroll
    // Only triggers on touch devices (phones/tablets) where hover doesn't work
    if (window.matchMedia('(pointer: coarse)').matches) {
        const envWrapper = document.getElementById('envelope-wrapper');
        if (envWrapper) {
            const envelopeObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        // Delay slightly so user sees the envelope first
                        setTimeout(() => envWrapper.classList.add('is-open'), 300);
                    } else {
                        // Reset when scrolled away so it animates fresh on next view
                        envWrapper.classList.remove('is-open');
                    }
                });
            }, { threshold: 0.5 }); // 50% visible before trigger
            envelopeObserver.observe(envWrapper);
        }
    }

    // 3. Custom Cursor
    if (window.matchMedia("(pointer: fine)").matches) {
        const createCursor = (cls) => {
            const el = document.createElement('div');
            el.className = cls;
            document.body.appendChild(el);
            return el;
        };
        const dot = createCursor('cursor-dot');
        const outline = createCursor('cursor-outline');

        let cursorRaf;
        window.addEventListener('mousemove', e => {
            if (cursorRaf) cancelAnimationFrame(cursorRaf);
            cursorRaf = requestAnimationFrame(() => {
                dot.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
                outline.animate({ transform: `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)` }, { duration: 500, fill: "forwards" });
            });
        });

        document.querySelectorAll('a, button, .cursor-pointer, .mockup, [role="button"]').forEach(el => {
            el.addEventListener('mouseenter', () => {
                document.body.classList.add('cursor-hover');
                if (el.closest('.bg-black')) document.body.classList.add('cursor-hover-dark');
            });
            el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover', 'cursor-hover-dark'));
        });
    }

    // 4. Magnetic Buttons
    document.querySelectorAll('.magnetic').forEach(el => {
        let rect;
        el.addEventListener('mouseenter', () => {
            rect = el.getBoundingClientRect();
        });
        el.addEventListener('mousemove', e => {
            if (!rect) rect = el.getBoundingClientRect();
            const { left, top, width, height } = rect;
            el.style.transform = `translate(${(e.clientX - left - width / 2) * 0.3}px, ${(e.clientY - top - height / 2) * 0.3}px)`;
            el.style.transition = 'transform 0.1s ease-out';
        });
        el.addEventListener('mouseleave', () => {
            el.style.transform = 'translate(0px, 0px)';
            el.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
    });

    // 5. Typewriter Effect
    const typewriters = document.querySelectorAll('.typewriter-trigger');
    typewriters.forEach(tw => {
        const sleep = ms => new Promise(res => setTimeout(res, ms));
        const type = async (text, speed, del = false) => {
            for (let i = del ? text.length : 0; del ? i >= 0 : i <= text.length; del ? i-- : i++) {
                tw.innerText = text.slice(0, i);
                await sleep(speed);
            }
        };
        (async () => {
            // Coordinate with laptop open + Apple Hello handwriting + macOS curtain lift
            await sleep(5100);
            await type("I'm Deepak S", 95);
        })();
    });

    // 6. Contact Form Animation
    const contactForm = document.getElementById('contact-form');
    const modal = document.getElementById('contact-modal');
    const env = document.getElementById('envelope-wrapper');
    if (contactForm && modal && env) {
        contactForm.addEventListener('submit', async e => {
            e.preventDefault();

            // Capture the form data
            const formData = new FormData(contactForm);
            const formAction = 'https://docs.google.com/forms/d/e/1FAIpQLSfSsdYm5_KItn3h5frACQMMZZoexgzVAdpLXUrvXA8ehsiR1g/formResponse';

            // Trigger the UI animation immediately
            const paper = modal.querySelector('.paper-modal');
            paper.classList.add('folding');
            modal.classList.add('sending');
            env.classList.add('is-receiving');

            // Send to Google Form in the background
            try {
                // Using 'no-cors' mode for Google Forms headless POST
                await fetch(formAction, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: formData
                });
            } catch (error) {
                console.warn('Form submission potential issue:', error);
                // We continue with UI animation anyway as 'no-cors' often throws a false-negative
            }

            setTimeout(() => {
                Object.assign(modal.style, { visibility: 'hidden' });
                modal.classList.remove('active', 'sending');
                paper.classList.remove('folding');
                document.body.style.overflow = 'auto';
                env.classList.replace('is-receiving', 'is-sent');

                setTimeout(() => {
                    env.style.visibility = 'hidden';
                    const msg = Object.assign(document.createElement('div'), {
                        className: "absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[#1a1a1a] text-[#f7f7f5] px-8 py-6 flex items-center gap-5 z-[999999] opacity-0 transition-opacity duration-500 shadow-2xl border border-white/10",
                        innerHTML: `<div class="flex items-center justify-center w-8 h-8 rounded-full bg-[#f7f7f5] text-[#1a1a1a] shrink-0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg></div><div class="flex flex-col"><span class="font-serif italic text-2xl leading-none mb-1">Message Sent</span><span class="text-[10px] uppercase tracking-widest text-[#f7f7f5]/60 block whitespace-nowrap">We'll be in touch</span></div>`
                    });
                    env.parentNode.appendChild(msg);

                    setTimeout(() => msg.classList.remove('opacity-0'), 50);
                    contactForm.reset();
                    modal.style.visibility = '';

                    setTimeout(() => {
                        msg.classList.add('opacity-0');
                        setTimeout(() => {
                            msg.remove();
                            env.style.visibility = 'visible';
                            env.classList.replace('is-sent', 'is-returning');
                            setTimeout(() => env.classList.remove('is-returning'), 1000);
                        }, 500);
                    }, 2500);
                }, 1500);
            }, 700);
        });
    }

    // 7. Dynamic Project Loader
    const loadProjects = async () => {
        const grid = document.getElementById('projects-grid');
        if (!grid) return;

        try {
            const response = await fetch('projects.json');
            const projects = await response.json();

            grid.innerHTML = projects.map((project, index) => {
                const imageUrl = (project.image && project.image !== "auto")
                    ? project.image
                    : `https://s.wordpress.com/mshots/v1/${encodeURIComponent(project.link)}?w=800`;

                return `
                    <a href="${project.link}" target="_blank" rel="noopener noreferrer" class="reveal-up delay-${(index + 1) * 100} h-[400px] block select-none">
                        <figure class="tilted-card-figure select-none">
                            <div class="tilted-card-mobile-alert">Check on desktop for effects.</div>
                            <div class="tilted-card-inner select-none">
                                <img src="${imageUrl}" alt="${project.title} - Project by Deepak S (Deepaksites)" class="tilted-card-img" draggable="false" loading="lazy" decoding="async">
                                <div class="tilted-card-overlay">
                                    <h3 class="text-xl font-serif italic mb-1">${project.title}</h3>
                                    <p class="text-[10px] uppercase tracking-widest opacity-80">${project.category}</p>
                                </div>
                            </div>
                            <figcaption class="tilted-card-caption">View Project</figcaption>
                        </figure>
                    </a>
                `;
            }).join('');

            makeImagesNonDraggable();
            initTiltedCards();
            grid.querySelectorAll('.reveal-up').forEach(el => revealObserver.observe(el));
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    };

    // 8. Tilted Card Animation
    let activeCards = [];
    let isGyroInitialized = false;

    const initTiltedCards = () => {
        const cards = document.querySelectorAll('.tilted-card-figure');
        const rotateAmplitude = 12;
        const scaleOnHover = 1.05;
        activeCards = Array.from(cards);

        // Hide mobile alerts if we're enabling gyro
        document.querySelectorAll('.tilted-card-mobile-alert').forEach(el => el.style.display = 'none');

        activeCards.forEach(card => {
            // Avoid re-attaching listeners if already initialized
            if (card.dataset.tiltedInit) return;
            card.dataset.tiltedInit = "true";

            const inner = card.querySelector('.tilted-card-inner');
            const caption = card.querySelector('.tilted-card-caption');
            let lastY = 0;
            let rafId;

            // Mouse handling (Desktop)
            let rect;
            card.addEventListener('mouseenter', () => {
                rect = card.getBoundingClientRect();
            });
            window.addEventListener('resize', () => {
                rect = null; // Mark for re-cache
            });

            card.addEventListener('mousemove', (e) => {
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    if (!rect) rect = card.getBoundingClientRect();
                    const offsetX = e.clientX - rect.left - rect.width / 2;
                    const offsetY = e.clientY - rect.top - rect.height / 2;

                    const rotationX = (offsetY / (rect.height / 2)) * -rotateAmplitude;
                    const rotationY = (offsetX / (rect.width / 2)) * rotateAmplitude;

                    inner.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg) scale(${scaleOnHover})`;

                    if (caption) {
                        const velocityY = offsetY - lastY;
                        const rotateCap = -velocityY * 0.6;
                        lastY = offsetY;

                        caption.style.left = `${e.clientX - rect.left}px`;
                        caption.style.top = `${e.clientY - rect.top}px`;
                        caption.style.transform = `translate(-50%, -120%) rotate(${rotateCap}deg)`;
                        caption.style.opacity = '1';
                    }
                });
            });

            card.addEventListener('mouseleave', () => {
                if (rafId) cancelAnimationFrame(rafId);
                inner.style.transform = `rotateX(0deg) rotateY(0deg) scale(1)`;
                if (caption) {
                    caption.style.opacity = '0';
                    caption.style.transform = `translate(-50%, -120%) rotate(0deg)`;
                }
            });
        });

        // Gyroscope Handling (Mobile) - Optimized Singleton Listener
        if (isGyroInitialized) return;

        let smoothedX = 0;
        let smoothedY = 0;
        const smoothing = 0.1;
        let mostCentralCard = null;
        let isProjectsVisible = false;
        let gyroRafId = null;

        // Only run gyroscope calculations when projects section is intersecting viewport
        const projectsSec = document.getElementById('projects');
        if (projectsSec && 'IntersectionObserver' in window) {
            const projObs = new IntersectionObserver((entries) => {
                isProjectsVisible = entries[0].isIntersecting;
            }, { rootMargin: '100px 0px' });
            projObs.observe(projectsSec);
        } else {
            isProjectsVisible = true;
        }

        // Cache central card on scroll/resize rather than calculating bounding boxes inside 60Hz gyro callback
        let centralCalcTimer = null;
        const updateCentralCard = () => {
            if (!isProjectsVisible || activeCards.length === 0) return;
            const viewportCenter = window.innerHeight / 2;
            let minDistance = Infinity;
            let candidate = null;

            activeCards.forEach(card => {
                const rect = card.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    const cardCenter = rect.top + rect.height / 2;
                    const dist = Math.abs(cardCenter - viewportCenter);
                    if (dist < minDistance) {
                        minDistance = dist;
                        candidate = card;
                    }
                }
            });

            if (candidate !== mostCentralCard) {
                // If central card changed, smoothly reset previous card
                if (mostCentralCard) {
                    const prevInner = mostCentralCard.querySelector('.tilted-card-inner');
                    if (prevInner) {
                        prevInner.style.transform = 'rotateX(0deg) rotateY(0deg)';
                        prevInner.style.transition = 'transform 0.4s ease';
                    }
                }
                mostCentralCard = candidate;
            }
        };

        window.addEventListener('scroll', () => {
            if (!centralCalcTimer) {
                centralCalcTimer = setTimeout(() => {
                    updateCentralCard();
                    centralCalcTimer = null;
                }, 100);
            }
        }, { passive: true });
        window.addEventListener('resize', updateCentralCard, { passive: true });
        setTimeout(updateCentralCard, 500);

        const handleOrientation = (e) => {
            if (!isProjectsVisible || !mostCentralCard || !e.beta) return;

            const b = e.beta;
            const g = e.gamma || 0;

            if (!gyroRafId) {
                gyroRafId = requestAnimationFrame(() => {
                    gyroRafId = null;
                    const targetX = Math.max(-1, Math.min(1, (b - 45) / 30));
                    const targetY = Math.max(-1, Math.min(1, g / 30));

                    smoothedX += (targetX - smoothedX) * smoothing;
                    smoothedY += (targetY - smoothedY) * smoothing;

                    const rotateX = smoothedX * rotateAmplitude;
                    const rotateY = smoothedY * -rotateAmplitude;

                    const inner = mostCentralCard.querySelector('.tilted-card-inner');
                    if (inner) {
                        inner.style.transform = `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
                        inner.style.transition = 'none';
                    }
                });
            }
        };

        if (window.DeviceOrientationEvent) {
            isGyroInitialized = true;
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                const triggerPermission = () => {
                    DeviceOrientationEvent.requestPermission()
                        .then(response => {
                            if (response === 'granted') {
                                window.addEventListener('deviceorientation', handleOrientation, { passive: true });
                            }
                        })
                        .catch(console.error);
                    window.removeEventListener('click', triggerPermission);
                    window.removeEventListener('touchstart', triggerPermission);
                };
                window.addEventListener('click', triggerPermission, { once: true });
                window.addEventListener('touchstart', triggerPermission, { once: true });
            } else {
                window.addEventListener('deviceorientation', handleOrientation, { passive: true });
            }
        }
    };


    // 9. Logo Loop Scroll Logic
    const initLogoLoop = () => {
        const loop = document.getElementById('logo-loop');
        const track = document.getElementById('logo-loop-track');
        const seq = document.getElementById('logo-loop-seq');
        if (!loop || !track || !seq) return;

        let seqWidth = 0;
        let isHovered = false;
        let speed = 60; // Base speed: pixels per second
        let offset = 0;
        let lastTimestamp = null;
        let currentVelocity = speed;
        let isActive = false;
        let retryCount = 0;

        const initializeTrack = () => {
            // Get the actual width of the original sequence
            seqWidth = seq.scrollWidth;
            if (seqWidth <= 0) {
                if (retryCount < 10) {
                    retryCount++;
                    setTimeout(initializeTrack, 200);
                }
                return;
            }

            const viewportWidth = loop.clientWidth || window.innerWidth;
            // Ensure we have enough copies to cover twice the viewport plus overlap
            const copiesNeeded = Math.ceil(viewportWidth / seqWidth) + 2;

            // Create the track content
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < copiesNeeded; i++) {
                const clone = seq.cloneNode(true);
                clone.removeAttribute('id');
                if (i > 0) clone.setAttribute('aria-hidden', 'true');
                fragment.appendChild(clone);
            }

            track.innerHTML = '';
            track.appendChild(fragment);

            if (!isActive) {
                isActive = true;
                if ('IntersectionObserver' in window) {
                    const loopObs = new IntersectionObserver((entries) => {
                        isLoopVisible = entries[0].isIntersecting;
                        if (isLoopVisible && !loopRafId) {
                            lastTimestamp = null;
                            loopRafId = requestAnimationFrame(animate);
                        } else if (!isLoopVisible && loopRafId) {
                            cancelAnimationFrame(loopRafId);
                            loopRafId = null;
                        }
                    }, { threshold: 0.05 });
                    loopObs.observe(loop);
                } else {
                    isLoopVisible = true;
                    loopRafId = requestAnimationFrame(animate);
                }
            }
        };

        let isLoopVisible = false;
        let loopRafId = null;

        const animate = (timestamp) => {
            if (!isLoopVisible) {
                loopRafId = null;
                return;
            }

            if (!lastTimestamp) lastTimestamp = timestamp;
            const deltaTime = Math.min((timestamp - lastTimestamp) / 1000, 0.1); // Cap delta to avoid jumps
            lastTimestamp = timestamp;

            const targetVelocity = isHovered ? 0 : speed;
            const easingFactor = 1 - Math.exp(-deltaTime / 0.25);
            currentVelocity += (targetVelocity - currentVelocity) * easingFactor;

            if (seqWidth > 0) {
                offset += currentVelocity * deltaTime;
                offset = offset % seqWidth;
                track.style.transform = `translate3d(${-offset}px, 0, 0)`;
            }
            loopRafId = requestAnimationFrame(animate);
        };

        // Hover events for pausing
        loop.addEventListener('mouseenter', () => isHovered = true);
        loop.addEventListener('mouseleave', () => isHovered = false);

        // Touch events for mobile
        loop.addEventListener('touchstart', () => isHovered = true, { passive: true });
        loop.addEventListener('touchend', () => isHovered = false, { passive: true });

        // Click on marquee item to jump orb directly to it
        loop.addEventListener('click', (e) => {
            const item = e.target.closest('.logo-loop-item');
            if (item && typeof handleMarqueeItemClick === 'function') {
                handleMarqueeItemClick(item);
            }
        });

        // Resize handling
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(initializeTrack, 250);
        });

        // Wait for images to load to get accurate dimensions
        const images = seq.querySelectorAll('img');
        let loadedCount = 0;

        const checkAllLoaded = () => {
            loadedCount++;
            if (loadedCount >= images.length) {
                // Short extra delay for layout settling
                setTimeout(initializeTrack, 100);
            }
        };

        if (images.length === 0) {
            initializeTrack();
        } else {
            images.forEach(img => {
                if (img.complete) {
                    checkAllLoaded();
                } else {
                    img.addEventListener('load', checkAllLoaded, { once: true });
                    img.addEventListener('error', checkAllLoaded, { once: true });
                }
            });
        }
    };

    // Infinite Tilted Marquee Banner (Programmatic duplication for clean & DRY markup)
    const initMarqueeBanner = () => {
        const track1 = document.getElementById('marquee-track-1');
        const track2 = document.getElementById('marquee-track-2');
        if (!track1 || !track2) return;

        // Prevent multiplying more than once
        if (track1.children.length > 8) return;

        const baseContent = track1.innerHTML;
        const repeatedContent = baseContent.repeat(5);

        track1.innerHTML = repeatedContent;
        track2.innerHTML = repeatedContent;
    };

    // Dynamic Headwind Streamlines along the Marquee (Flows Right -> Left against walking mascot)
    const initMarqueeWind = () => {
        const canvas = document.getElementById('marquee-wind-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        let width = 0;
        let height = 0;
        let dpr = 1;
        let currentWind = 0; // Smoothly interpolated 0.0 to 1.0
        let targetWind = 0;
        let rafId = null;

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width <= 0) return;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = rect.width;
            height = rect.height;
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
        };

        window.addEventListener('resize', resize, { passive: true });
        resize();

        // Stylized wind streamlines flowing right-to-left
        const STREAMLINE_COUNT = 30;
        const PARTICLE_COUNT = 20;

        const streamlines = Array.from({ length: STREAMLINE_COUNT }, () => ({
            x: Math.random() * ((typeof window !== 'undefined' ? window.innerWidth : 1440) + 400),
            yNorm: 0.12 + Math.random() * 0.76, // Height across upper topography and marquee
            speed: 520 + Math.random() * 520, // High velocity px/s right to left
            length: 140 + Math.random() * 220,
            thickness: 1.1 + Math.random() * 1.6,
            alpha: 0.18 + Math.random() * 0.32,
            waveFreq: 0.007 + Math.random() * 0.012,
            waveAmp: 5 + Math.random() * 9,
            phase: Math.random() * Math.PI * 2,
            isHighlight: Math.random() < 0.22
        }));

        const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
            x: Math.random() * ((typeof window !== 'undefined' ? window.innerWidth : 1440) + 200),
            yNorm: 0.12 + Math.random() * 0.76,
            speed: 750 + Math.random() * 650,
            size: 1.2 + Math.random() * 1.8,
            alpha: 0.22 + Math.random() * 0.38
        }));

        let lastTime = performance.now();

        const render = (now) => {
            const dt = Math.min(0.08, (now - lastTime) * 0.001);
            lastTime = now;

            // Smoothly ramp wind intensity up and down
            currentWind += (targetWind - currentWind) * Math.min(1, dt * 5.5);

            if (currentWind < 0.01 && targetWind === 0) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                canvas.style.opacity = '0';
                rafId = null;
                return;
            }

            canvas.style.opacity = (Math.min(1, 0.25 + currentWind * 0.75)).toFixed(2);

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, width, height);

            const slopeAngle = -2 * (Math.PI / 180); // -2 deg tilt aligned with Running Marquee slope
            const tanSlope = Math.tan(slopeAngle);

            // Dynamic gust modulation: breathing swells of intense gale force
            const gustWave = 1.0 + 0.38 * Math.sin(now * 0.0042) * Math.cos(now * 0.0021);
            const speedFactor = (0.75 + currentWind * 1.35) * gustWave;

            // Render aerodynamic wind streamlines
            streamlines.forEach((s) => {
                s.x -= s.speed * speedFactor * dt;
                if (s.x < -s.length - 120) {
                    s.x = width + 60 + Math.random() * 240;
                    s.yNorm = 0.12 + Math.random() * 0.76;
                }

                // Tip is leading edge (left), tail is trailing edge (right)
                const tipX = s.x;
                const tailX = s.x + s.length * (0.8 + currentWind * 0.55);
                const baseY = s.yNorm * height;

                ctx.beginPath();
                const stepCount = 9;
                for (let i = 0; i <= stepCount; i++) {
                    const u = i / stepCount; // 0 at tip (left), 1 at tail (right)
                    const px = tipX + (tailX - tipX) * u;
                    const tiltY = (px - width * 0.5) * tanSlope;
                    const waveY = Math.sin(px * s.waveFreq + s.phase + now * 0.005) * s.waveAmp;
                    const py = baseY + tiltY + waveY;

                    if (i === 0) {
                        ctx.moveTo(px, py);
                    } else {
                        ctx.lineTo(px, py);
                    }
                }

                const grad = ctx.createLinearGradient(tipX, 0, tailX, 0);
                const a = s.alpha * Math.min(1, 0.35 + currentWind * 0.65);
                if (s.isHighlight) {
                    grad.addColorStop(0, `rgba(255, 255, 255, ${a * 0.35})`);
                    grad.addColorStop(0.28, `rgba(255, 255, 255, ${a})`);
                    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                } else {
                    grad.addColorStop(0, `rgba(20, 20, 24, ${a * 0.35})`);
                    grad.addColorStop(0.28, `rgba(20, 20, 24, ${a})`);
                    grad.addColorStop(1, 'rgba(20, 20, 24, 0)');
                }

                ctx.strokeStyle = grad;
                ctx.lineWidth = s.thickness * (0.85 + currentWind * 0.45);
                ctx.lineCap = 'round';
                ctx.stroke();
            });

            // Fast wind dash motes
            particles.forEach((p) => {
                p.x -= p.speed * speedFactor * dt;
                if (p.x < -40) {
                    p.x = width + 30 + Math.random() * 140;
                    p.yNorm = 0.12 + Math.random() * 0.76;
                }
                const tiltY = (p.x - width * 0.5) * tanSlope;
                const py = p.yNorm * height + tiltY;

                ctx.beginPath();
                ctx.moveTo(p.x, py);
                ctx.lineTo(p.x + p.size * 5 * speedFactor, py);
                ctx.strokeStyle = `rgba(24, 24, 28, ${(p.alpha * Math.min(1, currentWind + 0.25)).toFixed(2)})`;
                ctx.lineWidth = p.size;
                ctx.lineCap = 'round';
                ctx.stroke();
            });

            ctx.restore();

            rafId = requestAnimationFrame(render);
        };

        window.updateMarqueeWindIntensity = (intensity) => {
            targetWind = Math.max(0, Math.min(1, intensity));
            if (targetWind > 0 && !rafId) {
                lastTime = performance.now();
                rafId = requestAnimationFrame(render);
            }
        };
    };

    // 7. Aether Vortex 3D Particle Floor Effect in CTA Section (Horizontal 3D Plate at Shadow)
    const initAetherVortex = () => {
        const contactSec = document.getElementById('contact');
        const container = document.getElementById('aether-vortex-container');
        const canvas = document.getElementById('aether-vortex-canvas');
        if (!contactSec || !container || !canvas) return;

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        let isRunning = true;
        let isVisible = false;
        let animId = null;
        // Default to SINGULARITY_COLLAPSE when closed, ACCRETION_DISK when open
        let topology = 'SINGULARITY_COLLAPSE';

        const isEnvelopeOpen = () => {
            const env = document.getElementById('envelope-wrapper');
            const modal = document.getElementById('contact-modal');
            if (!env) return false;
            return (
                env.matches(':hover') ||
                env.classList.contains('is-open') ||
                env.classList.contains('is-receiving') ||
                (modal && modal.classList.contains('active'))
            );
        };

        const mouse = {
            targetX: 0,
            targetY: 0,
            currentX: 0,
            currentY: 0,
            pointerX: -1000,
            pointerY: -1000,
        };

        let particles = [];
        let width = 0;
        let height = 0;
        let floorX = 0;
        let floorY = 0;
        let plateBottom = 0;
        let frameCount = 0;
        let time = 0;

        window.spawnMascotVortexParticle = () => {};
        window.removeMascotVortexParticle = () => {};

        window.emitAetherOrbParticle = () => {};
        window.addLeaderOrbParticle = () => {};
        window.removeLeaderOrbParticle = () => {};

        const updateFloorCenter = () => {
            const shadow = document.querySelector('#envelope-wrapper .shadow');
            if (shadow && contactSec) {
                const sRect = shadow.getBoundingClientRect();
                const cRect = contactSec.getBoundingClientRect();
                if (sRect.width > 0 && cRect.width > 0) {
                    floorX = (sRect.left - cRect.left) + (sRect.width / 2);
                    plateBottom = sRect.bottom - cRect.top;
                    // Position vortex center comfortably below the plate so the entire disc is below it
                    floorY = plateBottom + 35;
                    return;
                }
            }
            floorX = width / 2;
            floorY = height * 0.76;
            plateBottom = floorY - 35;
        };

        window.getAetherVortexCenter = () => {
            updateFloorCenter();
            return {
                floorX: floorX || (width / 2),
                floorY: floorY || (height * 0.76),
                plateBottom
            };
        };

        const initParticles = (w, h) => {
            const isMobile = w < 768;
            const count = isMobile ? 360 : 680;
            const newParticles = [];
            const maxR = Math.min(Math.max(w * 0.32, 280), 380);

            for (let i = 0; i < count; i++) {
                const rNorm = Math.pow(Math.random(), 0.65);
                const radius = 16 + rNorm * (maxR - 16);
                newParticles.push({
                    id: i,
                    angle: Math.random() * Math.PI * 2,
                    radius,
                    baseRadius: radius,
                    y: (Math.random() - 0.5) * 1.5,
                    speed: (Math.random() * 0.007 + 0.003),
                    mass: Math.random() * 1.1 + 0.45,
                    phase: Math.random() * Math.PI * 2,
                    prevX: undefined,
                    prevY: undefined,
                });
            }
            return newParticles;
        };

        const updateDimensions = () => {
            const rect = contactSec.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = rect.width;
            height = rect.height;

            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);

            updateFloorCenter();
            particles = initParticles(width, height);
            ctx.clearRect(0, 0, width, height);
        };

        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => updateDimensions());
            ro.observe(contactSec);
        } else {
            window.addEventListener('resize', updateDimensions);
        }
        updateDimensions();

        const render = () => {
            if (!isVisible || !isRunning) {
                animId = null;
                return;
            }

            time += 0.005;
            const t = time;

            mouse.currentX += (mouse.targetX - mouse.currentX) * 0.05;
            mouse.currentY += (mouse.targetY - mouse.currentY) * 0.05;

            ctx.clearRect(0, 0, width, height);

            // Periodically synchronize center with the shadow plate to stay locked even through layout/scroll shifts
            frameCount++;
            if (frameCount % 20 === 0 || floorY === 0) {
                updateFloorCenter();
            }

            // Accretion animation when envelope is open, Collapse when closed
            const open = isEnvelopeOpen();
            const targetTopology = open ? 'ACCRETION_DISK' : 'SINGULARITY_COLLAPSE';
            if (topology !== targetTopology) {
                topology = targetTopology;
                particles.forEach(p => {
                    p.prevX = undefined;
                    p.prevY = undefined;
                });
            }

            const centerX = floorX || (width / 2);
            const currentFloorY = floorY || (height * 0.76);

            // 3D Perspective Plate parameters
            // pitch = 1.47 (~84.2 degrees) tilts the disk much flatter to match the plate profile
            const pitch = 1.47;
            const cosP = Math.cos(pitch);
            const sinP = Math.sin(pitch);
            const fov = 650;
            const cameraZ = 650;
            const maxR = Math.min(Math.max(width * 0.32, 280), 380);

            const projected = [];

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                let x3D = 0;
                let z3D = 0;
                let y3D = 0;

                if (topology === 'ACCRETION_DISK') {
                    p.angle += p.speed * (80 / p.radius);
                    p.radius += (p.baseRadius - p.radius) * 0.03;
                    const wave = Math.sin(p.angle * 2 + t * 1.5) * 0.8;
                    y3D = p.y + wave;
                    x3D = Math.cos(p.angle) * p.radius;
                    z3D = Math.sin(p.angle) * p.radius;
                } else if (topology === 'SINGULARITY_COLLAPSE') {
                    p.angle += p.speed * (120 / Math.max(p.radius, 10));
                    p.radius *= 0.988;
                    p.y *= 0.98;

                    if (p.radius < 12) {
                        if (p.isMascot) {
                            particles.splice(i, 1);
                            i--;
                            continue;
                        }
                        const rNorm = Math.pow(Math.random(), 0.65);
                        p.radius = 16 + rNorm * (maxR - 16);
                        p.y = (Math.random() - 0.5) * 1.5;
                        p.prevX = undefined;
                        p.prevY = undefined;
                    }
                    y3D = p.y;
                    x3D = Math.cos(p.angle) * p.radius;
                    z3D = Math.sin(p.angle) * p.radius;
                } else if (topology === 'PULSAR_JETS') {
                    p.angle += p.speed * 1.4;
                    if (p.radius > 20) {
                        p.radius *= 0.96;
                        p.y *= 0.94;
                    } else {
                        p.y += (p.id % 2 === 0 ? 1 : -1) * (p.speed * 280);
                        if (Math.abs(p.y) > 95) {
                            p.radius = p.baseRadius;
                            p.y = (Math.random() - 0.5) * 1.5;
                            p.prevX = undefined;
                            p.prevY = undefined;
                        }
                    }
                    y3D = p.y;
                    x3D = Math.cos(p.angle) * p.radius;
                    z3D = Math.sin(p.angle) * p.radius;
                }

                // Front of plate (z3D > 0) is closer to the viewer
                const zCam = cameraZ - z3D * sinP - y3D * cosP;
                if (zCam <= 50) continue;

                const scale = fov / zCam;
                let projX = centerX + x3D * scale;
                let projY = currentFloorY + (z3D * cosP + y3D * sinP) * scale;

                // Only clip if it enters the physical envelope letter body (well above the plate)
                if (projY < plateBottom - 45) {
                    p.prevX = undefined;
                    p.prevY = undefined;
                    continue;
                }

                // 3D Depth metric: 0.0 (deep background) to 1.0 (closest foreground)
                const depthFactor = Math.max(0, Math.min(1, (z3D + maxR) / (2 * maxR)));

                // Depth-aware hover interaction:
                // Foreground particles react dramatically; background particles stay distant and subtle
                const depthWeight = 0.12 + Math.pow(depthFactor, 1.8) * 0.88;
                const dx = projX - mouse.pointerX;
                const dy = projY - mouse.pointerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const hoverRadius = 75 + depthFactor * 65; // 75px at back, 140px in front

                let interactiveScale = 1;
                let interactiveAlpha = 0;

                if (dist < hoverRadius) {
                    const force = (hoverRadius - dist) / hoverRadius;
                    // Strong physical deflection for foreground, minimal for background
                    projX += dx * force * 0.42 * depthWeight;
                    projY += dy * force * 0.42 * depthWeight;
                    interactiveScale = 1 + force * 1.85 * depthWeight;
                    interactiveAlpha = force * 0.35 * depthWeight;
                }

                // Atmospheric depth falloff: foreground particles are bold and dark; background particles are delicate and misty
                const baseAlpha = 0.12 + Math.pow(depthFactor, 1.3) * 0.76;
                const depthAlpha = Math.min(0.96, baseAlpha + interactiveAlpha);
                const size = Math.max(0.65, p.mass * Math.pow(scale, 1.45) * 1.15 * interactiveScale);

                projected.push({
                    p,
                    projX,
                    projY,
                    zCam,
                    depthAlpha,
                    size,
                });
            }

            // Depth sorting (back-to-front) for realistic 3D plate rendering
            projected.sort((a, b) => b.zCam - a.zCam);

            for (let i = 0; i < projected.length; i++) {
                const item = projected[i];
                const { p, projX, projY, depthAlpha, size } = item;

                if (p.prevX !== undefined && Math.hypot(projX - p.prevX, projY - p.prevY) < 32) {
                    ctx.beginPath();
                    ctx.moveTo(p.prevX, p.prevY);
                    ctx.lineTo(projX, projY);
                    ctx.strokeStyle = `rgba(0, 0, 0, ${Math.min(0.4, depthAlpha * 0.45)})`;
                    ctx.lineWidth = Math.max(0.8, size * 0.85);
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(projX, projY, size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.92, depthAlpha)})`;
                ctx.fill();

                p.prevX = projX;
                p.prevY = projY;
            }

            animId = requestAnimationFrame(render);
        };

        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    isVisible = entry.isIntersecting;
                    if (isVisible) {
                        if (typeof window.wakeOrbAnimation === 'function') {
                            window.wakeOrbAnimation();
                        }
                        if (!animId) {
                            animId = requestAnimationFrame(render);
                        }
                    }
                });
            }, { rootMargin: '120px' });
            io.observe(contactSec);
        } else {
            isVisible = true;
            animId = requestAnimationFrame(render);
        }

        contactSec.addEventListener('mousemove', (e) => {
            const rect = contactSec.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            mouse.pointerX = x;
            mouse.pointerY = y;
            mouse.targetX = (x - rect.width / 2) * 0.12;
            mouse.targetY = (y - rect.height / 2) * 0.12;
        });

        contactSec.addEventListener('mouseleave', () => {
            mouse.targetX = 0;
            mouse.targetY = 0;
            mouse.pointerX = -1000;
            mouse.pointerY = -1000;
        });

        contactSec.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches.length > 0) {
                const rect = contactSec.getBoundingClientRect();
                const touch = e.touches[0];
                const x = touch.clientX - rect.left;
                const y = touch.clientY - rect.top;

                mouse.pointerX = x;
                mouse.pointerY = y;
                mouse.targetX = (x - rect.width / 2) * 0.1;
                mouse.targetY = (y - rect.height / 2) * 0.1;
            }
        }, { passive: true });

        contactSec.addEventListener('touchend', () => {
            mouse.targetX = 0;
            mouse.targetY = 0;
            mouse.pointerX = -1000;
            mouse.pointerY = -1000;
        }, { passive: true });

        const envEl = document.getElementById('envelope-wrapper');
        if (envEl) {
            envEl.addEventListener('mouseenter', () => {
                if (topology !== 'ACCRETION_DISK') {
                    topology = 'ACCRETION_DISK';
                    particles.forEach(p => { p.prevX = undefined; p.prevY = undefined; });
                }
            });
            envEl.addEventListener('mouseleave', () => {
                if (!isEnvelopeOpen() && topology !== 'SINGULARITY_COLLAPSE') {
                    topology = 'SINGULARITY_COLLAPSE';
                    particles.forEach(p => { p.prevX = undefined; p.prevY = undefined; });
                }
            });
        }
    };



        // Live Orb WebGL Component
        const initLiveOrb = () => {
            const canvas = document.getElementById('live-orb-canvas');
            const wrapper = document.getElementById('live-orb-wrapper');
            const fallback = document.getElementById('live-orb-fallback');
            if (!canvas) return;

            const WHITE = { color: "#F4F4F5", eyeColor: "#09090B" };
            const BLACK = { color: "#18181B", eyeColor: "#F4F4F5" };
            const CUSTOM_DEFAULT = { color: "#7C5CFF", eyeColor: "#FAFAFA" };
            const WEBGL_COLORS = ["#7C6AF7", "#7DD3C7", "#E8B4D4"];

            const VERT = `
            attribute vec2 a_position;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
            `;
            const FRAG = `
            #ifdef GL_FRAGMENT_PRECISION_HIGH
            precision highp float;
            #else
            precision mediump float;
            #endif

            uniform vec2 u_resolution;
            uniform float u_time;
            uniform float u_speed;
            uniform vec2 u_look;
            uniform vec3 u_roll;
            uniform float u_blink;
            uniform float u_mode;
            uniform vec3 u_body;
            uniform vec3 u_eye;
            uniform vec3 u_c1;
            uniform vec3 u_c2;
            uniform vec3 u_c3;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            float fbm(vec2 p) {
                float v = 0.0;
                float a = 0.5;
                mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
                for (int i = 0; i < 5; i++) {
                    v += a * noise(p);
                    p = m * p;
                    a *= 0.5;
                }
                return v;
            }

            vec3 orient(vec3 p, vec2 look) {
                float yaw = look.x * 0.92;
                float pitch = -look.y * 0.78;
                float cy = cos(yaw);
                float sy = sin(yaw);
                float cp = cos(pitch);
                float sp = sin(pitch);
                vec3 q = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
                return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
            }

            vec3 rotateSphere(vec3 v, vec3 r) {
                float cz = cos(r.z); float sz = sin(r.z);
                vec3 v1 = vec3(v.x * cz - v.y * sz, v.x * sz + v.y * cz, v.z);

                float cx = cos(r.x); float sx = sin(r.x);
                vec3 v2 = vec3(v1.x, v1.y * cx + v1.z * sx, -v1.y * sx + v1.z * cx);

                float cy = cos(r.y); float sy = sin(r.y);
                return vec3(v2.x * cy + v2.z * sy, v2.y, -v2.x * sy + v2.z * cy);
            }

            float eyeMask(vec3 n, vec3 e, vec3 right, vec3 up, float halfH, float rad) {
                float facing = dot(n, e);
                float x = dot(n, right) - dot(e, right);
                float y = dot(n, up) - dot(e, up);
                y -= clamp(y, -halfH, halfH);
                float d = length(vec2(x, y)) - rad;
                float fill = 1.0 - smoothstep(-0.01, 0.01, d);
                return fill * smoothstep(0.12, 0.32, facing);
            }

            vec3 wash(vec3 n, float t) {
                vec2 q = n.xy * 2.2 + n.z * 0.85;
                vec2 w1 = vec2(
                    fbm(q * 1.4 + vec2(t * 0.22, t * 0.18)),
                    fbm(q * 1.4 + vec2(-t * 0.16, t * 0.24) + 4.1)
                );
                q += (w1 - 0.5) * 0.72;
                float f = fbm(q * 2.1 + vec2(0.0, t * 0.12));
                float g = fbm(q * 4.6 - vec2(t * 0.2, 0.0));
                vec3 col = mix(u_c1, u_c2, smoothstep(0.28, 0.72, f));
                return mix(col, u_c3, pow(smoothstep(0.42, 0.9, g), 1.4));
            }

            void main() {
                vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
                float aspect = u_resolution.x / max(u_resolution.y, 1.0);
                uv.x *= aspect;

                float radius = 0.94;
                vec2 p = uv / radius;
                float r2 = dot(p, p);
                float edge = 1.0 - smoothstep(0.985, 1.012, sqrt(max(r2, 0.0)));
                if (edge <= 0.001) {
                    gl_FragColor = vec4(0.0);
                    return;
                }

                float z = sqrt(max(1.0 - r2, 0.0));
                vec3 n = normalize(vec3(p, z));
                vec3 localN = rotateSphere(n, u_roll);

                vec2 look = u_look;
                float lm = length(look);
                if (lm > 1.0) look /= lm;

                vec3 right = orient(vec3(1.0, 0.0, 0.0), look);
                vec3 up = orient(vec3(0.0, 1.0, 0.0), look);
                vec3 eL = orient(normalize(vec3(-0.32, 0.08, 1.0)), look);
                vec3 eR = orient(normalize(vec3(0.32, 0.08, 1.0)), look);

                float halfH = mix(0.128, 0.012, u_blink);
                float rad = mix(0.054, 0.062, u_blink);
                float eyes = max(
                    eyeMask(localN, eL, right, up, halfH, rad),
                    eyeMask(localN, eR, right, up, halfH, rad)
                );

                vec3 body = u_mode > 0.5 ? wash(localN, u_time * u_speed) : u_body;
                vec3 col = mix(body, u_eye, clamp(eyes, 0.0, 1.0));

                gl_FragColor = vec4(clamp(col, 0.0, 1.0), edge);
            }
        `;

            function hexToRgb(hex) {
                const h = hex.replace("#", "").trim();
                const full = h.length === 3
                    ? h.split("").map((c) => c + c).join("")
                    : h.padEnd(6, "0").slice(0, 6);
                const n = parseInt(full, 16);
                if (isNaN(n)) return [0.96, 0.96, 0.96];
                return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
            }

            function compile(gl, type, source) {
                const shader = gl.createShader(type);
                if (!shader) return null;
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    gl.deleteShader(shader);
                    return null;
                }
                return shader;
            }

            function resolveVariant(variant, color, eyeColor, colors) {
                let body = BLACK.color;
                let eye = BLACK.eyeColor;
                let mode = 0;
                let palette = WEBGL_COLORS;

                if (variant === "white") {
                    body = WHITE.color;
                    eye = WHITE.eyeColor;
                } else if (variant === "black") {
                    body = BLACK.color;
                    eye = BLACK.eyeColor;
                } else if (variant === "webgl") {
                    palette = colors && colors.length > 0 ? colors : WEBGL_COLORS;
                    body = palette[1] || WEBGL_COLORS[1];
                    eye = "#0C0C10";
                    mode = 1;
                } else if (variant === "custom") {
                    body = color || CUSTOM_DEFAULT.color;
                    eye = eyeColor || CUSTOM_DEFAULT.eyeColor;
                }

                return { body, eye, mode, palette };
            }

            function createLiveOrb(canvasEl, initial = {}) {
                let options = {
                    variant: "black",
                    interactive: true,
                    blink: true,
                    ...initial,
                };

                const look = { x: 0, y: 0.08 };
                const targetLook = { x: 0, y: 0.08 };
                let rollPitch = 0;
                let rollYaw = 0;
                let rollTilt = 0;
                let reduce = false;

                const gl = canvasEl.getContext("webgl", {
                    alpha: true,
                    antialias: true,
                    depth: false,
                    stencil: false,
                    premultipliedAlpha: false,
                    powerPreference: "high-performance",
                });
                if (!gl) return null;

                const vs = compile(gl, gl.VERTEX_SHADER, VERT);
                const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
                if (!vs || !fs) return null;

                const program = gl.createProgram();
                if (!program) return null;
                gl.attachShader(program, vs);
                gl.attachShader(program, fs);
                gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

                gl.useProgram(program);
                if (options.onHasGl) options.onHasGl(true);

                const buf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(
                    gl.ARRAY_BUFFER,
                    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
                    gl.STATIC_DRAW,
                );
                const loc = gl.getAttribLocation(program, "a_position");
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

                const uResolution = gl.getUniformLocation(program, "u_resolution");
                const uTime = gl.getUniformLocation(program, "u_time");
                const uSpeed = gl.getUniformLocation(program, "u_speed");
                const uLook = gl.getUniformLocation(program, "u_look");
                const uRoll = gl.getUniformLocation(program, "u_roll");
                const uBlink = gl.getUniformLocation(program, "u_blink");
                const uMode = gl.getUniformLocation(program, "u_mode");
                const uBody = gl.getUniformLocation(program, "u_body");
                const uEye = gl.getUniformLocation(program, "u_eye");
                const uC1 = gl.getUniformLocation(program, "u_c1");
                const uC2 = gl.getUniformLocation(program, "u_c2");
                const uC3 = gl.getUniformLocation(program, "u_c3");

                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

                let raf = 0;
                let running = true;
                const start = performance.now();
                let nextBlink = start + 1800 + Math.random() * 2400;
                let blinkAt = -10000;

                const resize = () => {
                    const parent = canvasEl.parentElement;
                    if (!parent) return;
                    const dpr = Math.min(window.devicePixelRatio || 1, 3);
                    const w = parent.clientWidth || 36;
                    const h = parent.clientHeight || 36;
                    if (w <= 0 || h <= 0) return;

                    // 4x Supersampling for ultra-crisp Retina clarity
                    const targetRes = Math.max(Math.round(w * dpr * 2), 144);
                    canvasEl.width = targetRes;
                    canvasEl.height = targetRes;
                    canvasEl.style.width = `${w}px`;
                    canvasEl.style.height = `${h}px`;
                    gl.viewport(0, 0, targetRes, targetRes);
                };

                resize();
                const ro = new ResizeObserver(resize);
                if (canvasEl.parentElement) ro.observe(canvasEl.parentElement);

                const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
                const onReduce = () => { reduce = mqReduce.matches; };
                onReduce();
                mqReduce.addEventListener("change", onReduce);

                const onMove = (e) => {
                    if (!options.interactive) return;
                    const parent = canvasEl.parentElement;
                    if (!parent) return;
                    const rect = parent.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) return;

                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    const dx = e.clientX - cx;
                    const dy = cy - e.clientY;
                    const dist = Math.hypot(dx, dy);

                    const maxRange = Math.max(window.innerWidth * 0.45, 300);
                    const factor = Math.min(1.0, dist / maxRange);

                    if (dist > 0.001) {
                        targetLook.x = (dx / dist) * factor;
                        targetLook.y = (dy / dist) * factor;
                    } else {
                        targetLook.x = 0;
                        targetLook.y = 0.08;
                    }
                };
                let forcedLook = null;
                window.addEventListener("pointermove", onMove, { passive: true });

                const tick = (now) => {
                    if (!running) return;

                    const resolved = resolveVariant(
                        options.variant,
                        options.color,
                        options.eyeColor,
                        options.colors,
                    );
                    const time = (now - start) / 1000;

                    if (forcedLook !== null) {
                        look.x += (forcedLook.x - look.x) * 0.18;
                        look.y += (forcedLook.y - look.y) * 0.18;
                    } else if (options.interactive) {
                        look.x += (targetLook.x - look.x) * 0.16;
                        look.y += (targetLook.y - look.y) * 0.16;
                    } else {
                        look.x += (0 - look.x) * 0.12;
                        look.y += (0.08 - look.y) * 0.12;
                    }

                    if (!reduce && options.blink && now >= nextBlink) {
                        blinkAt = now;
                        nextBlink = now + 2200 + Math.random() * 3800;
                    }
                    const bt = (now - blinkAt) / 1000;
                    let b = 0;
                    if (!reduce && options.blink) {
                        if (bt < 0.055) b = bt / 0.055;
                        else if (bt < 0.1) b = 1;
                        else if (bt < 0.18) b = 1 - (bt - 0.1) / 0.08;
                    }
                    const body = hexToRgb(resolved.body);
                    const eye = hexToRgb(resolved.eye);
                    const palette = [0, 1, 2].map((i) =>
                        hexToRgb(
                            resolved.palette[i % resolved.palette.length] || WEBGL_COLORS[i]
                        )
                    );

                    gl.clearColor(0, 0, 0, 0);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    gl.uniform2f(uResolution, canvasEl.width, canvasEl.height);
                    gl.uniform1f(uTime, reduce ? 0 : time);
                    gl.uniform1f(uSpeed, reduce ? 0 : 0.55);
                    gl.uniform2f(uLook, look.x, look.y);
                    gl.uniform3f(uRoll, rollPitch, rollYaw, rollTilt);
                    gl.uniform1f(uBlink, b);
                    gl.uniform1f(uMode, resolved.mode);
                    gl.uniform3f(uBody, body[0], body[1], body[2]);
                    gl.uniform3f(uEye, eye[0], eye[1], eye[2]);
                    gl.uniform3f(uC1, palette[0][0], palette[0][1], palette[0][2]);
                    gl.uniform3f(uC2, palette[1][0], palette[1][1], palette[1][2]);
                    gl.uniform3f(uC3, palette[2][0], palette[2][1], palette[2][2]);

                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                    raf = requestAnimationFrame(tick);
                };

                raf = requestAnimationFrame(tick);

                return {
                    setRoll(pitch = 0, yaw = 0, tilt = 0) {
                        rollPitch = pitch;
                        rollYaw = yaw;
                        rollTilt = tilt;
                    },
                    setLook(x = null, y = null) {
                        if (x === null) {
                            forcedLook = null;
                        } else {
                            forcedLook = { x, y };
                        }
                    },
                    setOptions(next) {
                        options = { ...options, ...next };
                    },
                    destroy() {
                        running = false;
                        cancelAnimationFrame(raf);
                        ro.disconnect();
                        mqReduce.removeEventListener("change", onReduce);
                        window.removeEventListener("pointermove", onMove);
                        if (options.onHasGl) options.onHasGl(false);
                        gl.deleteProgram(program);
                        gl.deleteShader(vs);
                        gl.deleteShader(fs);
                        gl.deleteBuffer(buf);
                    },
                };
            }

            const orb = createLiveOrb(canvas, {
                variant: "black",
                interactive: true,
                blink: true,
                onHasGl: (hasGl) => {
                    if (fallback) {
                        fallback.style.display = hasGl ? "none" : "block";
                    }
                }
            });

            if (orb) {
                setLiveOrbRoll = (pitch = 0, yaw = 0, tilt = 0) => {
                    orb.setRoll(pitch, yaw, tilt);
                };
                window.setLiveOrbRoll = setLiveOrbRoll;
                setLiveOrbLook = (x = null, y = null) => {
                    orb.setLook(x, y);
                };
                window.setLiveOrbLook = setLiveOrbLook;
            }
        };


    const initAsciiEyes = () => {
        const container = document.getElementById("asciiEyesContainer");
        const el = document.getElementById("asciiEyesArt");
        if (!container || !el) return;

        const HEAD = ":::=::=::===::::-::::=====++++=++++++++*++**###########%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%@%@@%@@%@@%@%@@%@%%@%%%%%%%%%%%%%%@%%%@%%%%%%%%%%%%@%%%%%%@%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#########*+*****+=+++=+====+=====:::::=::::::::::--:\n:::====:=====::::=::====+===++====+++++=++**++***#***#####%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%@%@%@@%@%%%@@@%@@%@@%%%%%%%%@@%%%@%%@%%%%%%%@%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#%%#####*#####****#+++++++:==+=::==::=+===::::==:::::::::::::\n============::::::======:===::=+=::::=:++++==+**##*###%##%%#########%%%%%%%%%%%%%%%%%%%%%%%%%%#%%%%%%%%%%@%%%%%%%%@%@@%@@%@@@@%@%@%%%%@%%%%%%%%%@@%@@%%@%%%%%%%%%%%%%%%%%%%%#@#%%%%#%%%###**#####*##********++++*#**=+===:::--::==::+===:::-::+====::::::==:::::::::\n===========::::=====::===:===:-,--:==::::::==+***+++***++++*++::=:=+==+***+*++#%%###%%%%%%%%%%%%%%%%%%%%%%%%%%%%@@%%%%@%%%%%%%%@@@@@@@%%%%%@%@%%%@%@%%%%%%%%%%%%%%%%#%%#%%%*##*%%####*=***##*+****+=+***++=++++++--:--:::===:-,-::::=:::-::::--=+=:::---:=::::::::::\n=========:=::===:::==+::-,,...,---,,-:====++++=::=---::--:--::=+===++++==+*=+=.-*##*+*###%%*%%%%#%%%%%%%%%%%%%%%%%%%%%%%%%%@@@@@%%%@%%%@%%@%%@%@%%%%%%%%%%%%%%%%%%#%%+%%%%*%+*%####+,:#+++=++:=::--==:::-,,--:--,,,,---,,.,.-::=:::=:=::--,,,--,-:=+=:--::::::::::::\n======:::=::==::===:,.....,-,-,,..,-::,,..,,,,,::---::,,,,,,-:--::+=:=+=,:**-+#=,-:*##*+=*#%*%%%*%%*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%@%%%@%%%%%%%%%%%%%%%%%%%%%%%%#%%%=%%#*%-%%*++=.+#-,:-=,,::. -=+,.,,.,.,,,,,.:--,,,----,--:-,,,,..,.:=:-,,--,..-:=:--:::::::::::\n=:==::::=:-==:::-,,.  ..,,,..,,-:--:-,--==+::::=,......,-,,----,,-,-,-:=:..:*--*+,.,=##*,+*#%:*%%#@+%%%%%%%%%%%%%%%%%@%%%%%%%%%%%%%%%%%@@%%%%%%%%%%%%%%%%%%%%%%%%%%*#%:*%#%*,#+:*+,=+.=*.-,,:-..-:,,,,.,.,,,-:-:=:::=:-------,,--:=+*++--,,,----:-,..,:=:--:::::::::\n===::=::::==---,,.,,,,,...,,-:---:-,,.,,,...,.-,,----,,.,,..,,-,.,.,:::=:::.,+,.=*=, ,:#+.=#%*-#%%%:%%%%%#%%%%%%%%%%%%%%%%%%%%%@%%%%%%%%%%%%%%%%%%%%%%%#%%%%%%%#%%##%**#*#*:=*=:=-:--#: .=+,...,,,,,.,,,,,,-------::-:::::-::=:===::-,,,,----...,,,,...,-:-:::::::::\n==:=:::::::...........,-:==++++==::::=:-,--:-,,,,,.,-,,,..... ,--,.  .,--::=..=-.:**...:*+--*#++*#**##%%%%#%##%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#%**%*%**+#+-#+=+-:+-,::. ,*-  -::-,,..,,,,.,,--,-----:::--::=::::::-,:::==:::,-:::-.....  . ,:=::::==:\n==::::::-........,--:=:--,,.,,-:+=:=:-::=++=:::==---,-,,,,,,,. .,,,,... .,--=-,=,..:#+..-=*:,*%*+#-%##%##%#####%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#%%%%##%##%%###+=**%:-#+*=,=-:+:,.,=..,:-,.,,,-,,,.,,--,-,,,-:=:::=++:==++=+****##******+=====:,,.,..   -:::::=:\n=::=:---..,,..,,---:::=+++***+++++****####*++****##***++==:::--,.,,:-,--.. .,::,--,-,=:,,:+*=,+%##:=####%%#####%%%#%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%####%#%%#######*#+=**#*,-**+:*=+=-,,--.-,,,,--,,,.,,,,-----:--:=:::===++++**####*#**###%%#####**+=+=:-,..,. .:::::=\n=:-:---....,,,--::---==+++**##########%%%#####***######**++**+++=:-,-:-----,..,-,-:::.,-::++*=,:#++*=##################%##%%%%%%%%%%%%%%%%%%%%%%%##%%%########**#*:+#*#:+:+*+*::=----,,-----,,,,,-,,------:==:===+++***********#####################**+:-,.,. .=::::\n::::--...,,,,---=+********##******######%#################*+*+++===::-:::--::--,-----:----:==**-+*=*++#*#*###############%%%%%%%%%%%%%%%%%%%%%%%%%%%#########****#*==+*=+:+==::::=::---:::---------::::==++++++*++**********#*########****########***++++=-,.. .,:==\n::---,,,---:==:==+++*###******#########*#*################*#****+++=====-:::-::----:-:::::::=-+*=++++++**+*########*####%%%%%%%%%%%%%%%%%%%%%%%%%%#########*#****+*+++*++=+==::::::::::----------::::==++*+*********###*#*********#############***#****++===:--.,-:=";
        const TAIL = "+++==--=::::::::::::---,,-::=:====:+==+###%%%%%@@@%%#*=--,,-:+#%%%%%%%#%*+=======++*+##*#%%@@%@@@@%%**#*#*+*++++*+**+********######%%%%%%%%######***++==+=+++=++++++#++#*#%###%%%#%%%##**####*++=-=+==*#%#*::=-,--=*%%@@@%%%%%#***+*#=++=::---,,--:==+++++++++++*+++\n++========:========:::-----:::=::-:=**+=+**=***++***###*#%%%%%*==++:*#*##*+%%%%%#%%%#%%%%%%%%%%%%#%%###*****+++*+++**********######%%%%%%%######*****++=+++++==+++++++++##%%%%%%%%#%#%%%%#%%%%#%#%%%%+#=#%++###**####***#++++*==++=:=+=::=:-----::=++*************++\n=====++===+++++++++===::----::::+==**==*++*++##**++*###*###+#%%%#%@%%%%%##*#%##***#*#########%%%%%###*#***++++++++***********#######%%%%%%%######****++==++++++=++++++++=*#%%%%######***+*+**+++*##%*#*#%%*+%%**+##***:*++==:*#+===+:++=:-:---::===++**************+\n=====++=++*+**++*++++==:::---::==:+*=+**++*#*##*:=*#*+++*##++#+*#+*#*##+***++++**++****#%%%%%%%%%##*******+****++******+****#**#####%#####%%######***+++=+++++++++++++++*++##%%%#%###***+===**#*++++=::++:*:=#*:*+++*+=++#++++**++==::=::---::==++++***************+\n====+++++**+*****+++++====:::----::::+++=+**#**=***+*++*+*##*##+**+++++++++=+==+=+*##%%%%%%%%#%##*******+******************##*####%%%%%%%%%%%#####***+++++++++++++++++++++***##########*##**====+++*****+++==+*+=*#+**+=*++=++==+===-:---::==++++++****************+\n+==+++++*******+++++++++=+===::::::::::::===++=+++++++****++*+*++*++++++====+***######%%%%%%#%###*******************+****###*####%%%%%%%%%%%%%####***+++++==++++++++++*+++*****########%#####***=:====+++***+++===++=++:+=+========::=:===++++**********************";
        const EYE_FRAMES = {
            center: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:-:-,-,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+++=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.... ..,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==++=++**+****+*:=::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*############*#########**+=:::::===++++++**++*+++*+++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%#%%%%%%%%+*##%*+##*###*+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***#**++***#####%###=#*+====++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++****#****%%%+#%%*++#%%,#%#*#*+++**##+:,.   .,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=******+*###%%%@@%%%%%+#*+##%%*+%*+:===++++=::----:=+====++++==++====:::\n::::::===========++=====:, .,-===+==+++**+=++-,.  ..       .... .==,::++##**+++#*=:.   ..,,,------------:-:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+***++*###%%#*#=+:-,....     .--:.-=++=##*+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*+,.               .  .           .,-:+******+**-. . ..,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,..  ,=+**+****+*+--,,.        .                .,:+:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,       .,=,                    -%%=:.  ..,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+*##**=-,    ..                     ,:.       .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.      -*%%%%:          .  .        .#@@@%%#,.  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+:,.  .--**%.                      :%%%*-.      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .:*%@%%%@:   .      @@%@%:         %@@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,.. .=%@@@@%.       *@@@@.      .    +%%%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .+%%@%%%%@#  . ....  .#%::%, @ .     :%@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,=%@@@@@@%=    .   +#:-+ @@ .*      ,%@%%%%%#=,.      .,----::=============:\n===========:::::::----,.       ,+#%%@@@%%@@=                  . ,     .%@@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...,+*#%%@@@@@@@.               .  ,     .-%@%%@@%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@@%%@+           .    ,         -%@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@@@=        .    ..        ...%@%%%@@%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%@@@%%%%%-                        .%@@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@@%.            .  .        *@@@@@@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%@@@@%:   ,,,                ,%@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@@%-             .*,      *@%@@@@%%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@@%%-.                 .*@@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%@@@@@@@@@@@@@@+                  .:%@%%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%%@@@@@@@%-              -#@@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:===+=+*##%@@@@@@%*,             ,*%@@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            up: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:---,-,,,,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+++=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.......,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==+==+***+****+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*####*#######*##*##*###**+=:::::===++++++**++*+++*+++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%%%%%%%@%%**%%%+*##*###*+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***#**+**###%%%%%##%=##+====++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++****#**++##*-=**=::*##.#%###*+++**##+:,.   .,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=*******###%%%%%%#####:+::*#%%*+%**:===++++=::----:=+====++++==++====:::\n::::::===========++=====:, .,-===+==+****+==:..            .     --.,-=+##**+++#*=:.   ..,,,------------:-:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+***++*#####*:+,,.            ..,.,:=+=##*+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*=,.                          .    ,,:+******+**-. . ..,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,..  ,=+**+***#++:..                            .,:+:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,      .-+#.                    .%@#+,  ..,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+*##**:,.   .*.                     ,+:.      .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.      =#%%@#          ..            =@@@@%#,.  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+-,   -**@%:         ...           .%%%#=.      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .=#%@%%%%.   .      @@@@@:         #@@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,...,*@@@@@+        %@@@@.,-         -%%%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .+%%@%%%%@+      .    ,-  =  % -     ,%@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,=%@@@@@@%.        ,,  . %@ .+      ,%@%%%%%#=,.      .,----::=============:\n===========:::::::----,.       ,+#%%@@@@%@@:                          .%@@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...,+*#%%@@@@@@@-                       .-,#@%%@@%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@%%%%%                .         =@@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@@@#             -,          .%@%%%@%%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%%@%%%%@%#    .,.          .      -%@@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@@@*               +,       %@@@@@@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%@@@@%%:...                 .*@@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@@@%,             . ..   :%@%@@@@%%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@@@@%+.               .+%@@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%@@@@@@@@@@@@@@@*,               ,+%@@%%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*#####%%%@@@@@@@@%#+:-..    ..:*%@@@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:=====++*#%%%%%%%%%%*:....   .,:+%@@@@@@@@%%%%##**+===:::-,,,--::===+++++++++++",
            down: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:-:-,-,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+=+=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.... ..,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==++=++**+****+*:=::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*######################**+=:::::===++++++**++*++*++++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%#%%%%%%%%+*###+*##*##**+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***#**+****#######*#=##++==+++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++******+*+#%#*#%##**##%=##**#**++**#*+:,.    ,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=***++*+*###%#%%%%%%%%*##*####*+#*+:===++++=:::---:=+====++++==++====:::\n::::::===========++=====:, .,-===+==+++**+=++=::,-::-,,--:--:=:.=#*=*+**##**++*#*+=,   ..,,,--------------:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+*+*++***####%#%####=***=-:,-:+**::++*+***+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*+-,.           .     .     .     .--:+******+*+:... ..,,,,------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:--------,,,,,.   ,=+**+****+**+*+*=.=.-.. .                 ,-:+=++=::===:--=-,-:::====++++===:::\n:::====:============-. ,::::===+++:,                    .  .       -=+,,.  ..,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-=**++##**=:-..             .           ..        .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.      .-==**#,                    .*%@@%%#*..  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,,,..-+*+**#**+:,..  . ..*,                     .*##*=,.      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .:+#%%%%@#.         #%*%*.        ,@@@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,..  -*%%%@%#       ,*%%%            #%%%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .+%%@%%%%%%,   ..    .@@%%@= #       *@@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,=#%@@@@@@%        %@@%%.%@  . .    ,%@%%%%%#=-.      .,----::=============:\n===========:::::::----,.       ,+#%%%@%%@%@*    ...           = .     .%@@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...-+*#%%@@@@@@%-              -= .*      ,%@%%@%%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@@%%@:                .   ,     .%@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@@@,                       .-,#@%%@@%%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%@@@%%%%#                .      .  +@@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@@*        .    ..          ,@@@%%@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%%%@@*      .                 :@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@@:              .,       .@@@@@@%%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@@#.  ,..               .#@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%%@@@@@@@@@@@@*              ,-..   +@%%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%@@@@@@@*,                .+@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:===+=+*%%@@@@@@%:                .+%@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            left: "::::,,--===+==+**++******###########**##**############**#*********++++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::-----------:::===+***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:---,-,,,,,,,,,,.,,,,---:=::--:--::::::::::::=====+==+=+=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-----:--::::-,.... ..,,--======+++=:::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:=====++**+****+*==:-,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--:-::------:--..    .,=+*####*#######*#########**+=:::::===++++++**++*++*++++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,,-:++***##%%%%%%%%%%*+##%#=*##*###*+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::-----,,.    .-+**##**+***###%#%%#%+*#*====+++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++****#***#%#+#%%*++#%%-*%####++++**##+:,.   .,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=*****+*###%%%@%%%%%%*#*+#%%%%=*#*+:===++++=::----:======++++==++====:::\n::::::===========++=====:, .,-===+==+****+++:,.  ..      ....  -=:,::=++#***+++#*=:.   ..,,,------------:-:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+***++*##%%#**+=-,....      .,-:,,:=++=##*+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*=,.            .. .              ,,-:+******+**-. . ..,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,..  ,=+**+*****+:,,,                           ,,:=:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,      .:=                    -#%%=:,   ..,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+*##**:,.  ..                     ,-,.        .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.     .=#%%*           -          ,#%@@@@%%*..  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+-,. .-:*%,                      =%%%%#=,.      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .=#%@%@#  ..       %@@@%,       -%@@@@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,.. ,#@@@@.        +@@@@           +%%%%%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .*%@@%%%@.  ..   .  .%#-=%,:%     .+%@@@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,+%@@@@@+         #%:::.@@ .=     :%@%%%%%%%#=-.      .,----::=============:\n===========:::::::----,.       ,+#%%@@@%@%                  ,.      :%@@@@@@@@%%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...,+*#%@@@@@@,                .  .   ,-:#@%%%@@%%%*++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@%@%                         .*%@@@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@+              .      ....-%%%%%%@@%%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%@@%%%@=                        =%@@@@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@%.             .         .#@@@@@%@@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%@@@@:  ..                 ,*%@@@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@,            -.,-     ,%@%%@@@@@%%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@%,.                .+%@@@@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%@@@@@@@@@@@@=                 .,#%%%%%@@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%@@@@@@%,             ,*%@@@@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:=====+*#%@@@@@@+.            .:%@@@@@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            right: "::::,,--===+==+**++******###########**##**############**#*********++++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::-----------:::===+***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:---,-,,-,,,,,,,.,,,,---:=::--:--::::::::::::=====+==+=+=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-----:--::::-,.... ..,,,::======++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:=+=+=++**+****+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--:-::------:--..    .,=+*######################**+=:::::===++++++**++*++*++++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,,::++***###%%%%%%%%%%#+##%#+*#*###*+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::-----,,.    ,-+***#**+++**###%##%##*+#+====++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*+++****#****%%%+*%%#++#%#,%%*##+++**##+:,.   .,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=****+***#*##%%%%@%%%%@+#+*#%%#=#*+:===++++=::----:======++++==++====:::\n::::::===========++=====:, .,-===+==+++**++++=-,,  ...       ... .+=-:=+*#**+++#*=:.   ..,,,------------:-:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+**++=**####%%#+#=+:-..,..    .-:-.=++=*#*+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*+-..                .. .          ,,:+******+**-. . ..,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,..  ,=+**+*****+*+---,.. .                     .,:+:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,         .,:-.                  .#%=-   .,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+**#**+:-.     ..                    .:.      .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.       :+##%%##-             ..      *@@@%#,.  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+:,..  .,:-**#%,                    -%%#=.      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .-*#%%%%%%%%:    ..  @@@@%.         %@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,... ,=%@@@%@@%=     =@@@@.           :@%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .+%%@@%%%%%%%#,  . ..  #%=:%.,#   .   .%@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,:*%@@@@@@@@%#,     :#+-= %@ ,. ,     %@%%%%#=,.      .,----::=============:\n===========:::::::----,.       ,+#%%%@@@%@%%@%*.               .   ,    #@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...-+*#%%@@@@@@@@@%#.                     .,#@%@@%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@@@%%%%%#.                     .  %@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@@@@@@%-                     . #@%%@@%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%%@@%%%%%%%%*                       +@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@@@@@%*.                     -@@@%@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%%@%@@@%%*.  ,,..              +@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@@@@@@#.          .  --    -@%@@@@%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%%@@@@@@@%%%=..               ,%@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%%@@@@@@@@@@@@@@@%#,                .#@%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*#####%%%@@@@@@@@@%%=             :%@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:===+==+*#%%@@@@@@@@%*,            -%@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            up_left: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::-----------:::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:---,-,,,,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+++=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.......,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==+==+********+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*####*#######*#########**+=:::::===++++++**++*+++*+++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%%%%%%@%%#+##%#=*##*###*+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+**##**+**##%%%%%%#%**#*=+=:+++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++***##*++*##:=**+:=*#%-=%%###*+++**##+:,.   .,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=*******###%%%%%#%#%#=+=:+#%%%+*#*+:===++++=::----:=+====++++==++====:::\n::::::===========++=====:, .,-===+==+****===-..                 ,-..-:++##**+++#*=:.   ..,,,------------:-:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+***++*##%%*=+-,.            ..,..-=++=##*+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*=,                          .    ..-:+******+**-. . ..,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,..  ,=+**+****++,. .                           .,:=:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,      ,+*.                    =%@#+=.  ..,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+*##**-,   .=                      :+:.       .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.     .*%%@*           .           .#@@@@%%*..  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+-,  .=+%%,          .            +%%%%*:.      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .+#%@%@%   .       @@@@@# .      :%@@@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,.. -%@@@@,        =@@@@,.:         #%%%%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .*%@@%%%@-           -:  =, @,     .*%@@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,+%@@@@@*         .-. . %@. *     .*@@%%%%%%#=-.      .,----::=============:\n===========:::::::----,.       ,+#%%@@@%@@                          .*%@@@@@@@%%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...,+*#%@@@@@@*                      .,-,=%%%%@@@%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@%%@,                ,       .+%@@@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@%              ,.         .#@@%%%@@%%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%@@%%%@%   ..                  .=%@@@@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@*             ,-.,      .#@%@@@@@@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%@@@@%, ..                .=#@@@@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@%.             .=.   .=%%%%@@@@@%%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@@#:               .=#%@@@@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%%@@@@@@@@@@@@=.              .-*%@%%%%@@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%@@@@@@@%+:,.      .,=#%@@@@@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:=====+*##%%@@@@%#=,.      .-=*%@@@@@@@@@@%%%%##**+===:::-,,,--::===+++++++++++",
            up_right: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:---,,,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+++=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.......,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:=+=+=++**+****+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*######################**+=:::::===++++++**++*+++*+++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***###%%%%%%%@%%#*#%%#+##*###*+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    ,-+***#**++**###%%%%%#%**#+====++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++*****#**=+##*-+**=:=*%=-%%*##+++**##+:,.   .,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=****+***###%%%%%%###%#:*:+#%%#=#**:===++++=::----:=+====++++==++====:::\n::::::===========++=====:, .,-===+==++***+===-..                 .:-,-=+*#**+++#*=:.   ..,,,------------:-:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+**++=**######:=-,.            .,..:=+=##*+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*+-.                           .   ,,:+******+**-. . ..,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,..  ,=+**+*****++:..                           .,:+:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,       .-=+=                    .%%+:   .,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+*##**=-,     .:.                    ,+,      .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.      ,+%%%@%=         .             +@@@%#,.  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+:,.   :**#%*+        .             ,%%%=,      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .:*%%@%%%##,    ..  .@@@@%          %@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,....:#@@@@%%#,      %@@@@ ,.         :@%%%%+,      .,---:---:::============:\n==========::::::::::,,-,..       .+%%@@%%%@%%#.         -: .= =+  ..   ,%@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,=#@@@@@@%%%*.  .   .-. . @% :  .    .@@%%%%#=,.      .,----::=============:\n===========:::::::----,.       ,+#%%%@@@@@%%@#.                         %@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...-+*#%%@@@@@@@@@%-                     .,,%@%@@%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@@@%%%%%+         .    .         ,@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@@@@@@*.     .    ..          .%@%%@@%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%%@@%%%%%@%%*.   .,.          .     %@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@@@@@@#,              ,      #@@@@@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%@@@@@@%%%=..,.               -%@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@@@@@@%-          .  ,,.   #@%@@@@%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%%@@@@@@@@@%%=.              .#@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%%@@@@@@@@@@@@@@@@%*,              ,*@@%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*#####%%%%@@@@@@@@@@%#=-,.     .,=%@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:======+*##%%%%%%%%%%%#:,.      .,=%@@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            down_left: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:-:-,-,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+=+=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.... ..,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==++=+***+*#**+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*############*#########**+=:::::===++++++**++*++*++++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%#%%%%%%%#+*###++##*###*+:-.     .,----::::::::::::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***#**+*****####%###=#*++=:+++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++*********%%##%%##*#%%++##**#*+++**#*+:,.    ,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=****+*+*####%%%%%%%%%%#**####+*#*+:===++++=::----:=++===++++==++====:::\n::::::===========++=====:, .,-===+==+++**++*+:-.,--,..,-.,-:=- +#*=+++++#***+++#*+:,   ..,,,--------------:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:-------,-,,,,,..  .,=+***++**##########+=*=+,,,.,:+**=,=+++=#**+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*+,.                .             ,-::+******+*+-. . ..,,,,------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:--------,,,,,.   ,=+**+******++=+,,,..  .                   ,-:=:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,        .        ..          .::=,.,   ..,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+*##**=:.                                     .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.      -+*##=          .         .*%@@@@%%#+..  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+:,.  ...*+                     .+###*+-,       ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .:*%@%@@,          *@#%*,       ,%@@@@@@@%%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,.. .=%%%@#        .#%%%.          +%%%%%%%*+,      .,---:---:::============:\n==========::::::::::,,-,..       .+%%@%%%@+  .,       @@%%@+ %.    .*%@@@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,=%@@@@@@.        #@%%% %@  =     ,#%%%%%%%%#=-.      .,----::=============:\n===========:::::::----,.       ,+#%%@@%%@@.                  *      ,*%@@@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...,+*#%@@@@@@+               :%  +     ,#@@%%@@%%%*++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@%@%                  ,.      .*@@@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@#                      ..-,=%%%%@@@%%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%@@%%%@:                         :%@@@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@              .          .#@@%@%@@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%%@@,                       -%@@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@%                ,       #@%@@@@@%%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@+  ..                .+%@@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%%@@@@@@@@@@@,            -,..    ,%@%%@@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%@@@@@%+.                =%@@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:===+=+*%%@@@@@%,               .:%@@@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            down_right: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:-:-,-,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+=+=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.... ..,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:=+++=+***+****+*:=::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*############*#########**+=:::::===++++++**++*++*++++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%#%%%%%%%#+*###+**#*###*+:-.     .,----::::::::::::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***##*+****#########=*#++=:=++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++******+**#%%##%%%#+#%%*=%#*#*+++**#*+:,.    ,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=****+*+*#**###%%%%%%%%#%*#####+#*+:===++++=::----:=++===++++==++====:::\n::::::===========++=====:, .,-===+==+++**+++*+=:-.,::=..,-,,,,:- =*+=+++*#**+++#*+:,   ..,,,--------------:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:-------,-,,,,,..  .,=+**+++**#*######%####*=+==.,..,+*=,+++=*#*+=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*+-,.                   .          --:+******+*+-. . ..,,,,------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:--------,,,,,.   ,=+**+****+***+****:,=.-.                  .-:+:+*=::===:--=-,-:=:====++++===:::\n:::====:============-. ,::::==++++:,                      .         ,**,,  ..,++++*#+*+=::. ..,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,. ..-+**+*##**+::-..                         ..       .,=+++::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.       ,-=:+++*:                    =%@@%%#,.  .,=+****+=+=,.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,-,..-+*+**#**+:-,.    . . =-.                    *%#*-.      ..,:::=:,,:::::============:\n=========:::==::-,,,::,-:::,.      .-=+%%%%%%%#=.       %#*%#          @@@@@@%#,,. ..,=+##+=#*-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,... .-*%%%#@#%*     -*%%%            #@%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .+#%@@%%%%%%%#.  . .   @@%%@ :+       =@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,:*%%@@@@@@@@#.     %@%%% @% ,       .@@%%%%#=,.      .,----::=============:\n===========:::::::----,.       ,+#%%%@@%%%%%@%:  .  -         .-  .,    %@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...-+*#%%@@@@@@@@%%-            -= ,  .    ,%@%@@%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@@@%%@@#.                        .%@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@@@@@%.                     .,.%@%@@@%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%%@@@%%%%%%,                        +@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@@@@%-                       -@@@%@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%%%%%%%#.    .                 -@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@@@@#.            -  .     .@@@@@@%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%%@@@@@@%#-  .,.               #@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%%@@@@@@@@@@@@@@%.             .-.   +@%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%@@@@@@@@@#-.               =@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:===+=+*#%%@@@@@@@%=               .*@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            squint: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:-:-,-,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+=+=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.... ..,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==++=++**+****+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*######################**+=:::::===++++++**++*++*++++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%%%%%%%%%%+*###+*##*##**+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***#**+***######%###=##++==+++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++******+++###+*##*++*##=*#****++**##*+:-.    ,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=***+**+*######%%%%#%%*#*+#*##++#*+:==+++++=::----:=+====++++==++====:::\n::::::===========++=====:, .,-===+==+*+**====:::-::=====:++***##*#########*#******+-. ...,,,--------------:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+***++*##########%######*##*#**#***#**+**++=:====::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*++*=-,,.,,,-:=::----::--:--,-,---,,-:=++**#***++*+=-,....,,,,------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,.   ,=+++=++**###*++*+=+==::::=::,-,-----------=++++++=::===:--=-,-=::====++++===:::\n:::====:============-. ,::::==++++:,..    ..,:,                    ,#%:-.  ..-=+++*#+*++::-..,,,,-------::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,....-=++++****=:,.   ..                     ,,.      ..-=++=::==:,::--::=====+++====::\n:===============::-. ,:--:====:,.      ,=*#%#+          .           -%@@@%%*..  .,=+****+=+=-.,,--,-------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,,,..-+*+**#**+:,.. .,,==%.                      +%%#+-.      ..,:::::,,:::::============:\n=========:::==::-,,,::,-:::,.      .:*#%%%%@+          @@%@@:        .%@@@@@@%#,,. ..,=+##+=**-,,-:-:--:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:*##*##*=-,.. .:#@@@@%,       +%@@@.           +%%%%%#+,      .,---:---:::============:\n==========::::::::::,,-,..       .+%%@%%%%%%. . ,.    .%%++%, %       =%@@@@@@@%%*,....,-+##=+##=-::::::::::::::==++++****#####%%%%%%%%%%%%%%####***+++======::::::::::::--=####%#+-....,=#@@@@@@@*        #%*=* @@ .=      ,%@%%%%%#=-.      .,----::=============:\n===========:::::::----,.       ,+#%%%@@%%@@+      .           , :.    .%@@@@@@@%%%%#=,....,+%#+#%#=:::=::==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::=#%%%%*-,...-+*#%%@@@@@@%.               ,  :     .-%@%%@@%%#++,       ..,--::=============\n===========:::::::--,...   .. ,:+#%%@@@@%%@=                .         ,%@@@@@@@@%%%%%#+=,,,.,*%*+#%#*=+=:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%%%#:-,.,-=#%@@@@@@@@@@@:             .         .,.%@%%@@%%%**+. .    ..,,,-::============\n++=========::::---,....  ..-:.:=*%%%@@@%%%%%.               .         #@@@@@@@@@%%@@%%@%+:=:..-#%%##*++++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-.,:-,%%#%%%%@@@@@@@@@%             ..          +@@@@%@%%#=*+,,-,.    .,--:::======+====\n+++++======:::---,......,,.,:==*###%%%%%%%@@%.   ....         .     .#@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..*%%%*%@@%%%@@@@@@@@@@@%.             .+.      =@%@@@@%%#*+*+=:,.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@@%*...                 =%@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%%@@@@@@@@@@@@%-              ...  ,%@%%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%@@@@@@@%*.              .=%@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:===+=+*#%%@@@@@@%:.             .=%@@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            half: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:-:-,-,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+=+=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.... ..,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==++=++**+****+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*######################**+=:::::===++++++**++*++*++++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%%%%%%%%%%+*###+*##*##**+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***#**+***######%###=##++==+++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++******+++###+*##*++*##=*#*****+**##*+:-.    ,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=***+**+*###%##%%%%#%%*#*+#*##++#*+:=++++++=::----:=+====++++==++====:::\n::::::===========++=====:, .,-===+==+*+**====---,::::=:=:++**+******#*##**+*****#*+-. ...,,,--------------:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+***++*#****##*#######*#*##*****+++*+++*+++======::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*+++=,.,.,--:=+=+==***+****#*#*####*#####**#***+***=--....,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,.   ,=+**=++*+*****###################*#*+***++++++=========:--=-,-=::====++++===:::\n:::====:============-. ,::::==+++=-....,--:=:=:=::====+++**+****#*############*+++===++==::,,,,,,------:-:::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,...,-=*==+=++*+++*+**####%%%#%%%#####**#*****+++++========:=:::=:,::--::=====+++====::\n:===============::-. ,:--:====:,...,--------:::::=:====+++++****####%#######***++=======:+=::::-,---------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,,,.,:=++=:==+===+++++***###%%%%%%%%%%%#####****+++++=+===:=:::::--:::,-:::::============:\n=========:::==::-,,,::,-:::,.   ..,----------::::::==:=++++****#######%%####**++++===::::=::::::-------:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:+=:::=:===+====+++*+**##%##%%%#%##%###**#****+=++===:==::::---:-------:::============:\n==========::::::::::,,-,..    ..,,,,,,,----:-::::::::=+==+++**#*######*###+*+*++===::::=::::----,,------::::::::==++++****#####%%%%%%%%%%%%%%####***+++======:::::::::::---:=:-:-::::::::==::===++**####%%%##%##%#####***+++===:::=:=:::::::----,---::=============:\n===========:::::::----,.     ..,----::::::=-,,,,,,,,,,,,---:-:=+++==+==*#####**++==:=:-,---::=:-::,,.. .:=::=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+::-..,:=:------::=++***++*#=:==:=====++====+====::::=====++===:::-,,,,,,,,,-----:============\n===========:::::::--,...      .-=*#%%%%%%%%+           .    ,      .  -%@@@@@@@%%%%%%*=:,.-,-+#*++#=:-==:===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+=:#%%##=,,,,--=#%%%@@@@@@@@@=       ..    ,.        ...%%%%%%%%#++=. .    .....,-:============\n++=========::::---,....  ..-:.:+*%%%@@@%%%@%,                         %@@@@@@@@@%%@@%%@%+:=:..-#%%#%#**++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%:.-:,,%%#%%%%@@@@@@@@@%.            .           *@@@@@@%%#+*+,,-..    .--::::======+====\n+++++======:::---,......,,.,:==*###%%%%%@@@@%:   ,,,                ,%@@@@@@@@@@@%@%%@@%*#%%%+:-:#%%#***#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=..+%%%*%@@%%%@@@@@@@@@@@%-             .*,      *@%@@@@%%#*+*+=:-.......,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+####%%%%@@@@@@%%-.                 .*@@@@@@@@@@@@@@%%@@%#%%%%#%%+*=*#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++*##*#@@%@@@@@@@@@@@@@@+                  .:%@%%@@@@@%%#***+=--,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*####%%%%@@@@@@@%-              -#@@@@@@@@@@%%%#*++**+==+*###%%@%%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+=====:::-=:===+=+*##%@@@@@@%*,             ,*%@@@@@@@%%%##**+===:::-,,,--::===+++++++++++",
            closed: "::::,,--===+==+**++******###########**##**############**#**********+++==:::::-------:-::::=:==:====+++++++=*+****#*######%%###%%%%%%%%%%#%%%%%%%%##########*****+++++++======:::::::-----:---::::======::------------::==++***##********###*#*******+++**=::-,-,,-:=\n::-,,--::::=++++++++++**********##########**++===:-:-,-,,-,,,,,,,.,,,,--:==::--:--::::::::::::=====+==+++=++=++**######*#####%%%%%%%%%%%%###%%###########***++++=+========:::::::-::-------:::::-,.... ..,,-:======+++==::----:::==+++++++*************+**+====:-,:=\n=:---:==+=+++**++***************+**+=:------:-:==++=++**+****+*==::,,...   ..,-:-:-::::::::::::::::::===+++++=+****#**#########%%%%%#%%%%%%%%##%#####******++++=====:::::::::--::::------::-..    .,=+*######################**+=:::::===++++++**++*+++*+++++++==--:\n:--:::===+++=+++++++++++++++*++:...,,-::++***##%%%%%%%%%%%+*###+*##*##**+:-.     .,----::::::::-:::::::::===::===++****#########%#%%%###############*****++====::::::-:---------::------,.    .-+***#**+***######%###=##++==+++*****+=:---::=++=++++++++++++====:-,=\n::::===+++===++==++++++==+=:,...,-:+++*++******+++###+*##*++*##=*#*****+**##*+:-.    ,,,,----::::::::--------:::=+++**+**##########%%%%%%##########******+===:::::---:---------------.    .-=***+**+*###%##%%%%#%%*#*+#*##++#*+:=++++++=::----:=+====++++==++====:::\n::::::===========++=====:, .,-===+==+*+**====---,::::=:=:++**+******#*##**+*****#*+-. ...,,,------------:-:::=====++******#####%#%%#%%%%%%%%######*****+++====::::-:---------,,,,,..  .,=+***++*#****##*#######*#*##*****+++*+++*+++======::-:-,-====:==+++==+===:::\n:::================:::-. .-:====++*+++=,.,.,--:=+=+==***+****#*#*####*#####**#***+***=--....,,,-------::::::==::::==++****######%%%%%%%%%%%######******++=:::::::-:---------,,,,.   ,=+**=++*+*****###################*#*+***++++++=========:--=-,-:=:====++++===:::\n:::====:============-. ,::::==+++=-....,--:=:=:=::====+++**+****#*############*+++===++==::,,,,,,------:::::::::::===++***########%%%%%%%%%%%####****+++=:::::::-:::::------,,...,-=*==+=++*+++*+**####%%%#%%%#####**#*****+++++========:=:::=:,::--::=====+++====::\n:===============::-. ,:--:====:,...,--------:::::=:====+++++****####%#######***++=======:+=::::-,---------:-::::=+=+++++***#####%%%%%%%%%%%%%%###****++=:::::::-::::::----,,,.,:=++=:==+===+++++***###%%%%%%%%%%%#####****+++++=+===:=:::::--:::,-:::::============:\n=========:::==::-,,,::,-:::,.   ..,-----,----:=::::==:=++++****#######%%####**+++====::::=::::::-------:-----:::==+=++*****#####%%%%%%%%%%%%%###*#**++=====:::-:=:=:::-----,,:==:::=:===+====+++*+**##%##%%%#%##%###**#****+=++===:==::::---:-------:::============:\n==========::::::::::,,-,..    ..,,,,,,-----:-::::-::::===++++*#**#*##**###****+++==::::::::::---,----::-::::::::==++++****#####%%%%%%%%%%%%%%####***+++======:::::::::::--:=+=:--:::::=::=====+++*+*##**##%#########**+*++++====:==:=:::::::----,---:==============:\n===========:::::::----,.     .---,,,,,,-,,,----------:::===+++*#*#**##**+*++++===::-=::::----------,.   ,==:=::===++++*****####%%%%%%%%%%%%%%#####**++=============::=+:-.  .,-:::::-:::==:=+=:==+++*******########****+++===::-:::::::---------::::--,,============\n===========:::::::--,...         .,,,---,,,,-,-----:::::===+=++************++=====::=---:--:::--,    .---===:=====+++++****#####%%%%%%%%%%%%%###***++=============::=+==#%*-.   .-:===::::-::+:+=++++**#*###*#####***+++=+==::::::::---::--:-,...      .============\n++=========::::---,....  ..,:,,.      ...,--:-:---,,-,,-:-::=+=++++++++++==+==::::=::==::,,,.    .,:-=+++==+======++++******####%%%%%%%%%%%%%%##***+++=++=+===========+###%%-::.     ,-,::+++:+===:+=++++*********++++==:::-,:--:=:=:-,,..       .,,-::::======+====\n+++++======:::---,......,,.,::=+=:-,.        ..,------:-::==+=+++*+*********+====-,..       ..-::=*+**+*#*+++==+++++++******####%%%%%%%%%%%%%####***++====++==+++++:==+#%%=.,+##*+=-..     ...,-:++++*#*####********+*++=:::---,..       ...,,,--,,,,--::::===++++==\n+++++==::::----,-,,,-,,,,,,-:=+*#****+====-,..        . ...,---------,,...,....   ..,,,-=:+==**=+++#%##**++++=+++*+++++****######%%%%%%%%%%%%#####**+==+==+===+=+++=+**#+:,,+++***++#**+==,,,...   ...,,,---:+===:--,,.         ..,-:::===---,..,,,,-:::====+++++++=\n+++===-:-::----:--,--,,,,----:==*#####%%%%%%%%%#+-.             ..,,::-:=::::--::::=++:==+*##%%@@%%%*#%**+++++++**+*++*****#*#####%%%%%%%#%######***++=+=+++++===+=***#+:*+======::::::::=:====+++====--..            .:=**########**+++=:=::--,,,--::===+++++++++++"
        };

        // Pre-compile full 37x260 strings for instant zero-allocation text swaps
        const FRAMES = {};
        for (const [key, mid] of Object.entries(EYE_FRAMES)) {
            FRAMES[key] = HEAD + "\n" + mid + "\n" + TAIL;
        }

        let currentFrame = "";
        const setFrame = (frameKey) => {
            if (currentFrame === frameKey || !FRAMES[frameKey]) return;
            currentFrame = frameKey;
            el.textContent = FRAMES[frameKey];
        };

        // Responsive font scaling with 100.00% edge-to-edge lock
        const fitAscii = () => {
            const availableWidth = container.clientWidth || window.innerWidth;
            if (!availableWidth) return;
            el.style.transform = "none";
            el.style.fontSize = "12px";
            const measuredWidth = el.scrollWidth;
            if (!measuredWidth) return;
            const targetFont = (availableWidth / measuredWidth) * 12;
            el.style.fontSize = `${targetFont}px`;
            el.style.lineHeight = `${targetFont * 0.96}px`;

            const currentWidth = el.getBoundingClientRect().width;
            if (currentWidth > 0) {
                const scaleX = availableWidth / currentWidth;
                el.style.transformOrigin = "center center";
                el.style.transform = `scaleX(${scaleX})`;
            }
        };

        fitAscii();
        window.addEventListener("resize", fitAscii, { passive: true });
        if (window.ResizeObserver) {
            new ResizeObserver(fitAscii).observe(container);
        }

        // Start in relaxed closed state
        setFrame("closed");

        let isAwake = false;
        let isBlinking = false;
        let isHovered = false;
        let currentGaze = "center";
        let lastUserInteraction = 0;

        let blinkTimeout = null;
        let wanderTimeout = null;
        let wakeTimeout = null;
        let hoverTimeout = null;

        // 1. FREE 2D GAZE MAPPING:
        const computeGazeDirection = (targetX, targetY) => {
            const rect = container.getBoundingClientRect();
            const eyeCenterX = rect.left + rect.width * 0.5;
            const eyeCenterY = rect.top + rect.height * 0.5;

            const dx = targetX - eyeCenterX;
            const dy = targetY - eyeCenterY;
            const dist = Math.hypot(dx, dy);

            // Deadband threshold: direct eye contact when cursor is close to eyes
            if (dist < 140) return "center";

            const angle = Math.atan2(dy, dx) * (180 / Math.PI);

            if (angle >= -25 && angle <= 25) return "right";
            if (angle > 25 && angle < 65) return "down_right";
            if (angle >= 65 && angle <= 115) return "down";
            if (angle > 115 && angle < 155) return "down_left";
            if (angle >= 155 || angle <= -155) return "left";
            if (angle > -155 && angle < -115) return "up_left";
            if (angle >= -115 && angle <= -65) return "up";
            if (angle > -65 && angle < -25) return "up_right";
            return "center";
        };

        // 2. INTERACTIVE CURSOR TRACKING:
        // 2. INTERACTIVE CURSOR TRACKING WITH NATURAL DWELL:
        // When cursor moves, eyes follow. When cursor stops, eyes fixate on it for a moment,
        // then smoothly return to direct eye contact (the Stare)!
        let mouseSettleTimeout = null;

        const handleMouseMove = (e) => {
            if (!isAwake || isBlinking || isHovered) return;
            lastUserInteraction = Date.now();
            clearTimeout(mouseSettleTimeout);

            const dir = computeGazeDirection(e.clientX, e.clientY);
            if (dir !== currentGaze) {
                currentGaze = dir;
                setFrame(dir);
            }

            // When mouse stops moving: fixate on that spot for 2.2s, then calmly return to staring at the user
            mouseSettleTimeout = setTimeout(() => {
                if (!isAwake || isBlinking || isHovered) return;
                currentGaze = "center";
                setFrame("center");
                cognitiveState = "STARE";
                scheduleNextCognitiveEvent();
            }, 2200);
        };

        window.addEventListener("mousemove", handleMouseMove, { passive: true });

        // 3. HUMAN COGNITIVE ATTENTION ENGINE:
        // Real eyes don't nervously twitch every 1.5s. They have distinct mental modes:
        // - THE STARE: Long, intense direct eye contact with the viewer (4.5s - 9.0s)
        // - THE THOUGHTFUL GLANCE: Glancing up-left or up-right into space to reflect (2.8s - 5.0s)
        // - THE QUICK CHECK: Glancing sideways/down momentarily (1.0s - 1.8s), then immediately returning to the stare
        let cognitiveState = "STARE";

        const scheduleNextCognitiveEvent = () => {
            if (!isAwake) return;
            clearTimeout(wanderTimeout);

            // If user recently moved mouse, pause autonomous shifts
            if (Date.now() - lastUserInteraction < 2400) {
                wanderTimeout = setTimeout(scheduleNextCognitiveEvent, 1200);
                return;
            }

            let delay = 4000;

            if (cognitiveState === "STARE") {
                // Currently holding eye contact. What to do next?
                const roll = Math.random();
                if (roll < 0.48) {
                    // Hold the stare! Deep, calm, grounded eye contact
                    currentGaze = "center";
                    delay = 5000 + Math.random() * 4500; // 5.0s to 9.5s long stare
                    cognitiveState = "STARE";
                } else if (roll < 0.76) {
                    // Quick check: brief look away to the side or down
                    const quickChecks = ["left", "right", "down", "down_left", "down_right"];
                    currentGaze = quickChecks[Math.floor(Math.random() * quickChecks.length)];
                    delay = 1000 + Math.random() * 900; // 1.0s to 1.9s brief glance
                    cognitiveState = "CHECK";
                } else {
                    // Thoughtful daydream: looking up-left or up-right into space to recall/think
                    currentGaze = Math.random() < 0.5 ? "up_left" : "up_right";
                    delay = 2800 + Math.random() * 2200; // 2.8s to 5.0s thinking gaze
                    cognitiveState = "THOUGHTFUL";
                }
            } else if (cognitiveState === "CHECK") {
                // After a quick glance away, return directly to staring at the user!
                currentGaze = "center";
                delay = 4500 + Math.random() * 4000; // 4.5s to 8.5s direct stare
                cognitiveState = "STARE";
            } else if (cognitiveState === "THOUGHTFUL") {
                // After thinking, return directly to eye contact with the user
                currentGaze = "center";
                delay = 4500 + Math.random() * 4000;
                cognitiveState = "STARE";
            }

            setFrame(currentGaze);
            wanderTimeout = setTimeout(scheduleNextCognitiveEvent, delay);
        };

        // 4. NATURAL BLINK LIFECYCLE:
        const triggerBlink = (onComplete) => {
            if (!isAwake || isBlinking) return;
            isBlinking = true;

            const r = Math.random();
            let downMs = 38;
            let holdMs = 55;
            let upMs = 42;
            if (r < 0.20) {
                downMs = 60; holdMs = 110; upMs = 60;
            } else if (r < 0.30) {
                downMs = 25; holdMs = 35; upMs = 25;
            }

            setFrame("half");
            setTimeout(() => {
                if (!isAwake) { isBlinking = false; return; }
                setFrame("closed");

                setTimeout(() => {
                    if (!isAwake) { isBlinking = false; return; }

                    // During blink: if user was looking away thinking/checking, settle back to center stare
                    if (!isHovered && Date.now() - lastUserInteraction > 2400) {
                        if (cognitiveState === "CHECK" || cognitiveState === "THOUGHTFUL") {
                            currentGaze = "center";
                            cognitiveState = "STARE";
                        }
                    }

                    setFrame("half");
                    setTimeout(() => {
                        isBlinking = false;
                        if (!isAwake) return;
                        setFrame(currentGaze);
                        if (onComplete) onComplete();
                    }, upMs);
                }, holdMs);
            }, downMs);
        };

        const scheduleNextBlink = () => {
            if (!isAwake) return;
            clearTimeout(blinkTimeout);
            const delay = 3400 + Math.random() * 3500;
            blinkTimeout = setTimeout(() => {
                if (!isAwake) return;
                const isDouble = Math.random() < 0.20;
                triggerBlink(() => {
                    if (isDouble && isAwake) {
                        setTimeout(() => {
                            triggerBlink(() => scheduleNextBlink());
                        }, 110 + Math.random() * 50);
                    } else {
                        scheduleNextBlink();
                    }
                });
            }, delay);
        };

        // 5. ATTENTIVE MICRO-SQUINT ON HOVER:
        const footerInteractive = container.closest("footer")?.querySelectorAll("a, button, input");
        if (footerInteractive) {
            footerInteractive.forEach((elLink) => {
                elLink.addEventListener("mouseenter", () => {
                    if (!isAwake) return;
                    isHovered = true;
                    clearTimeout(hoverTimeout);
                    if (!isBlinking) {
                        setFrame("squint");
                        hoverTimeout = setTimeout(() => {
                            if (!isAwake || isBlinking || !isHovered) return;
                            setFrame("down");
                        }, 180);
                    }
                }, { passive: true });

                elLink.addEventListener("mouseleave", () => {
                    if (!isAwake) return;
                    isHovered = false;
                    clearTimeout(hoverTimeout);
                    if (!isBlinking) {
                        setFrame(currentGaze);
                    }
                }, { passive: true });
            });
        }

        // 6. LIFECYCLE MANAGEMENT:
        const wakeUp = () => {
            if (isAwake) return;
            isAwake = true;
            clearTimeout(wakeTimeout);
            wakeTimeout = setTimeout(() => {
                if (!isAwake) return;
                setFrame("half");
                wakeTimeout = setTimeout(() => {
                    if (!isAwake) return;
                    currentGaze = "center";
                    setFrame("center");
                    scheduleNextBlink();
                    scheduleNextCognitiveEvent();
                }, 140);
            }, 180);
        };

        const sleep = () => {
            isAwake = false;
            clearTimeout(blinkTimeout);
            clearTimeout(wanderTimeout);
            clearTimeout(wakeTimeout);
            clearTimeout(hoverTimeout);
            setFrame("closed");
        };

        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) wakeUp();
                    else sleep();
                });
            }, { threshold: 0.15 });
            observer.observe(container);
        } else {
            wakeUp();
        }

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) sleep();
            else {
                const rect = container.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) wakeUp();
            }
        });
    };

    loadProjects();
    initLogoLoop();
    initMarqueeBanner();
    initMarqueeWind();
    initAetherVortex();
    initLiveOrb();
    initAsciiEyes();
});

