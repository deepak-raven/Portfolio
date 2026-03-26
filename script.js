document.addEventListener('DOMContentLoaded', () => {
    // 1. Laptop Scroll Animation
    const laptop = document.querySelector('.laptop');
    const laptopBlock = document.querySelector('.laptop-block');
    const laptopTop = document.querySelector('.laptop-top');
    if (laptop && laptopBlock && laptopTop) {
        let currentProgress = 1; // Start closed
        let targetProgress = Math.max(0, Math.min(1, window.scrollY / 450));

        const updateAnimation = () => {
            currentProgress += (targetProgress - currentProgress) * 0.08;
            laptopBlock.style.transform = `translate3d(0, 0, 0) rotateY(-${currentProgress * 90}deg)`;
            
            if (currentProgress >= 0.99) {
                laptopTop.style.opacity = 1;
                laptopTop.style.transform = 'scale(1)';
                laptopTop.style.top = '0px';
                laptopTop.style.left = '20px';
                laptopTop.style.zIndex = 0;
                laptopBlock.classList.remove('glare-active');
            } else {
                laptopTop.style.opacity = 0;
                laptopTop.style.zIndex = -5;
                
                if (currentProgress > 0.01 && currentProgress < 0.99) {
                    laptopBlock.classList.add('glare-active');
                    const glareX = -150 + (currentProgress * 300);
                    const glareY = -150 + (currentProgress * 300);
                    laptopBlock.style.setProperty('--glare-pos', `${glareX}% ${glareY}%`);
                } else {
                    laptopBlock.classList.remove('glare-active');
                }
            }
            requestAnimationFrame(updateAnimation);
        };

        window.addEventListener('scroll', () => {
            targetProgress = Math.max(0, Math.min(1, window.scrollY / 450));
        });
        updateAnimation();
    }

    // 2. Reveal Up Observer
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal-up').forEach(el => revealObserver.observe(el));

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

        window.addEventListener('mousemove', e => {
            dot.style.left = `${e.clientX}px`;
            dot.style.top = `${e.clientY}px`;
            outline.animate({ left: `${e.clientX}px`, top: `${e.clientY}px` }, { duration: 500, fill: "forwards" });
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
        el.addEventListener('mousemove', e => {
            const { left, top, width, height } = el.getBoundingClientRect();
            el.style.transform = `translate(${(e.clientX - left - width / 2) * 0.3}px, ${(e.clientY - top - height / 2) * 0.3}px)`;
            el.style.transition = 'transform 0.1s ease-out';
        });
        el.addEventListener('mouseleave', () => {
            el.style.transform = 'translate(0px, 0px)';
            el.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
    });

    // 5. Typewriter Effect
    const tw = document.getElementById('typewriter');
    if (tw) {
        const sleep = ms => new Promise(res => setTimeout(res, ms));
        const type = async (text, speed, del = false) => {
            for (let i = del ? text.length : 0; del ? i >= 0 : i <= text.length; del ? i-- : i++) {
                tw.innerText = text.slice(0, i);
                await sleep(speed);
            }
        };
        (async () => {
            await sleep(800);
            await type("Hello", 100);
            await sleep(1000);
            await type("Hello", 60, true);
            await sleep(400);
            await type("I'm Deepak S", 100);
        })();
    }

    // 6. Contact Form Animation
    const contactForm = document.getElementById('contact-form');
    const modal = document.getElementById('contact-modal');
    const env = document.getElementById('envelope-wrapper');
    if (contactForm && modal && env) {
        contactForm.addEventListener('submit', e => {
            e.preventDefault();
            const paper = modal.querySelector('.paper-modal');
            paper.classList.add('folding');
            modal.classList.add('sending');
            env.classList.add('is-receiving');

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
                    <a href="${project.link}" target="_blank" rel="noopener noreferrer" class="reveal-up delay-${(index + 1) * 100} h-[400px] block">
                        <figure class="tilted-card-figure">
                            <div class="tilted-card-mobile-alert">Check on desktop for effects.</div>
                            <div class="tilted-card-inner">
                                <img src="${imageUrl}" alt="${project.title}" class="tilted-card-img">
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

            initTiltedCards();
            grid.querySelectorAll('.reveal-up').forEach(el => revealObserver.observe(el));
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    };

    // 8. Tilted Card Animation
    const initTiltedCards = () => {
        const cards = document.querySelectorAll('.tilted-card-figure');
        cards.forEach(card => {
            const inner = card.querySelector('.tilted-card-inner');
            const caption = card.querySelector('.tilted-card-caption');
            const rotateAmplitude = 12;
            const scaleOnHover = 1.05;
            let lastY = 0;
            
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
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

            card.addEventListener('mouseleave', () => {
                inner.style.transform = `rotateX(0deg) rotateY(0deg) scale(1)`;
                if (caption) {
                    caption.style.opacity = '0';
                    caption.style.transform = `translate(-50%, -120%) rotate(0deg)`;
                }
            });
        });
    };

    // 9. Logo Loop Scroll Logic
    const initLogoLoop = () => {
        const loop = document.getElementById('logo-loop');
        const track = document.getElementById('logo-loop-track');
        const seq = document.getElementById('logo-loop-seq');
        if (!loop || !track || !seq) return;

        let seqWidth = 0;
        let isHovered = false;
        let speed = 60; 
        let offset = 0;
        let lastTimestamp = null;
        let currentVelocity = speed;

        const initializeTrack = () => {
            seqWidth = seq.getBoundingClientRect().width;
            if (seqWidth === 0) return;

            const viewportWidth = loop.clientWidth;
            const copiesNeeded = Math.ceil(viewportWidth / seqWidth) + 2;
            
            const originalSeq = seq.cloneNode(true);
            track.innerHTML = '';
            for (let i = 0; i < copiesNeeded; i++) {
                const clone = originalSeq.cloneNode(true);
                clone.removeAttribute('id');
                if (i > 0) clone.setAttribute('aria-hidden', 'true');
                track.appendChild(clone);
            }
        };

        const animate = (timestamp) => {
            if (!lastTimestamp) lastTimestamp = timestamp;
            const deltaTime = (timestamp - lastTimestamp) / 1000;
            lastTimestamp = timestamp;

            const targetVelocity = isHovered ? 0 : speed;
            const easingFactor = 1 - Math.exp(-deltaTime / 0.25);
            currentVelocity += (targetVelocity - currentVelocity) * easingFactor;

            if (seqWidth > 0) {
                offset += currentVelocity * deltaTime;
                offset = offset % seqWidth;
                track.style.transform = `translate3d(${-offset}px, 0, 0)`;
            }
            requestAnimationFrame(animate);
        };

        loop.addEventListener('mouseenter', () => isHovered = true);
        loop.addEventListener('mouseleave', () => isHovered = false);
        window.addEventListener('resize', initializeTrack);
        
        const images = seq.querySelectorAll('img');
        let loadedCount = 0;
        const checkAllLoaded = () => {
            loadedCount++;
            if (loadedCount >= images.length) {
                initializeTrack();
                requestAnimationFrame(animate);
            }
        };

        if (images.length === 0) {
            initializeTrack();
            requestAnimationFrame(animate);
        } else {
            images.forEach(img => {
                if (img.complete) checkAllLoaded();
                else {
                    img.addEventListener('load', checkAllLoaded, { once: true });
                    img.addEventListener('error', checkAllLoaded, { once: true });
                }
            });
        }
    };

    loadProjects();
    initLogoLoop();
});
