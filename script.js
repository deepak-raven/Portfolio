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

    // 1. Laptop Scroll Animation (Only for Desktop)
    const laptop = document.querySelector('.laptop');
    const laptopBlock = document.querySelector('.laptop-block');
    const laptopTop = document.querySelector('.laptop-top');
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;

    if (isDesktop && laptop && laptopBlock && laptopTop) {
        let currentProgress = 1; // Start fully closed
        let targetProgress = 1;
        let rafId = null;
        let isLaptopVisible = false;
        let introComplete = false; // Flag: has the open-on-load animation finished?

        const screenContent = document.querySelector('.screen-content');

        const updateAnimation = () => {
            const diff = targetProgress - currentProgress;
            const ease = introComplete ? 0.15 : 0.04;
            currentProgress += diff * ease;

            laptopBlock.style.transform = `translate3d(0, 0, 0) rotateY(-${currentProgress * 90}deg)`;

            if (currentProgress >= 0.99) {
                // Last 5% of closing: hide the block so no pixel bleeds through the edge
                laptopBlock.style.visibility = 'hidden';
                laptopBlock.style.opacity = '0';
                if (screenContent) screenContent.style.visibility = 'hidden';

                if (currentProgress >= 0.99) {
                    // Fully closed: show the lid
                    laptopTop.style.opacity = 1;
                    laptopTop.style.transform = 'scale(1)';
                    laptopTop.style.top = '0px';
                    laptopTop.style.left = '20px';
                    laptopTop.style.zIndex = 0;
                } else {
                    laptopTop.style.opacity = 0;
                    laptopTop.style.zIndex = -5;
                }
                laptopBlock.classList.remove('glare-active');
            } else {
                // Opening — reveal everything
                laptopBlock.style.visibility = 'visible';
                laptopBlock.style.opacity = '1';
                laptopTop.style.opacity = 0;
                laptopTop.style.zIndex = -5;
                if (screenContent) screenContent.style.visibility = 'visible';

                if (currentProgress > 0.01) {
                    laptopBlock.classList.add('glare-active');
                    const glareX = -150 + (currentProgress * 300);
                    const glareY = -150 + (currentProgress * 300);
                    laptopBlock.style.setProperty('--glare-pos', `${glareX}% ${glareY}%`);
                } else {
                    laptopBlock.classList.remove('glare-active');
                }
            }

            if (Math.abs(targetProgress - currentProgress) > 0.0001) {
                laptop.classList.remove('laptop--opened');
                rafId = requestAnimationFrame(updateAnimation);
            } else {
                currentProgress = targetProgress;
                rafId = null;
                // Once the intro open animation reaches 0, mark it done & enable scroll
                if (!introComplete && targetProgress === 0) {
                    introComplete = true;
                }
                if (currentProgress === 0) {
                    laptop.classList.add('laptop--opened');
                } else {
                    laptop.classList.remove('laptop--opened');
                }
            }
        };

        const handleScroll = () => {
            if (!isLaptopVisible || !introComplete) return;
            const scrollPos = (lenis && typeof lenis.scroll === 'number') ? lenis.scroll : window.pageYOffset;
            targetProgress = Math.max(0, Math.min(1, scrollPos / 450));
            if (targetProgress > 0) {
                laptop.classList.remove('laptop--opened');
            }
            if (!rafId) {
                rafId = requestAnimationFrame(updateAnimation);
            }
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isLaptopVisible = entry.isIntersecting;
                if (isLaptopVisible) {
                    if (introComplete) handleScroll();
                    if (lenis) {
                        lenis.on('scroll', handleScroll);
                    } else {
                        window.addEventListener('scroll', handleScroll, { passive: true });
                    }
                } else {
                    if (lenis) {
                        lenis.off('scroll', handleScroll);
                    } else {
                        window.removeEventListener('scroll', handleScroll);
                    }
                }
            });
        }, { threshold: 0 });

        const container = document.querySelector('.laptop-container');
        if (container) observer.observe(container);

        // Paint the closed state immediately so the lid is visible
        updateAnimation();

        // Stay closed for 1 second, then smoothly open
        setTimeout(() => {
            targetProgress = 0; // Animate to fully open
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
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 900);
        }, 4700);
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

    loadProjects();
    initLogoLoop();
});

