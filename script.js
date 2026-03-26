document.addEventListener('DOMContentLoaded', () => {
    // 1. Laptop Scroll Animation
    const laptop = document.querySelector('.laptop');
    const laptopBlock = document.querySelector('.laptop-block');
    const laptopTop = document.querySelector('.laptop-top');
    if (laptop && laptopBlock && laptopTop) {
        let currentProgress = 0;
        let targetProgress = 0;

        // Easing function for buttery smooth updates
        const updateAnimation = () => {
            // Lerp linearly interpolates the current value to the target value 
            currentProgress += (targetProgress - currentProgress) * 0.08;
            
            // Swing the screen block smoothly
            laptopBlock.style.transform = `translate3d(0, 0, 0) rotateY(-${currentProgress * 90}deg)`;
            
            // Just make the lid appear ONLY when fully closed
            if (currentProgress >= 0.99) {
                laptopTop.style.opacity = 1;
                laptopTop.style.transform = 'scale(1)';
                laptopTop.style.top = '0px';
                laptopTop.style.left = '20px';
                laptopTop.style.zIndex = 0;
            } else {
                laptopTop.style.opacity = 0;
                laptopTop.style.zIndex = -5;
            }

            requestAnimationFrame(updateAnimation);
        };

        window.addEventListener('scroll', () => {
            // Fluid progress target from 0 (open) to 1 (closed) over 450px
            targetProgress = Math.max(0, Math.min(1, window.scrollY / 450));
        });

        // Kick off the loop
        updateAnimation();
    }

    // 2. Intersection Observer for Scroll Animations
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal-up').forEach(el => observer.observe(el));

    // 3. Custom Cursor
    if (window.matchMedia("(pointer: fine)").matches) {
        const createCursor = (cls) => {
            const el = document.createElement('div');
            el.className = cls;
            document.body.appendChild(el);
            return el;
        };
        const dot = createCursor('cursor-dot'), outline = createCursor('cursor-outline');

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

    // 6. Projects Fetch & Archive Logic
    const projectsGrid = document.getElementById('projects-grid');
    if (projectsGrid) {
        const previewEl = Object.assign(document.createElement('div'), { className: 'archive-row-preview', innerHTML: '<img src="" alt="" />' });
        document.body.appendChild(previewEl);
        const previewImg = previewEl.querySelector('img');

        document.addEventListener('mousemove', e => {
            previewEl.style.left = `${e.clientX + 28}px`;
            previewEl.style.top = `${e.clientY - 80}px`;
        });

        fetch('./projects.json').then(res => res.json()).then(repos => {
            if (!repos?.length) throw new Error("No projects");
            projectsGrid.innerHTML = '';

            const countEl = document.getElementById('archive-count');
            if (countEl) {
                let c = 0;
                const step = () => { countEl.textContent = String(++c).padStart(2, '0'); if (c < repos.length) requestAnimationFrame(step); };
                setTimeout(step, 400);
            }

            repos.forEach((repo, i) => {
                const row = Object.assign(document.createElement('a'), {
                    className: 'archive-row', href: repo.link || '#', target: '_blank', rel: 'noopener noreferrer'
                });
                row.style.animationDelay = `${i * 120}ms`;
                row.innerHTML = `
                    <span class="archive-row-index">${String(i + 1).padStart(2, '0')}</span>
                    <div class="archive-row-body">
                        <h3 class="archive-row-title">${repo.title}</h3>
                        <div class="archive-row-meta"><span class="archive-row-category">${repo.category}</span></div>
                        <p class="archive-row-desc">${repo.description}</p>
                    </div>
                    <div class="archive-row-image-thumb"><img src="${repo.image || ''}" alt="${repo.title}" loading="lazy"></div>
                    <div class="archive-row-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg></div>
                `;
                row.onmouseenter = () => { previewImg.src = repo.image || ''; previewEl.classList.add('visible'); };
                row.onmouseleave = () => previewEl.classList.remove('visible');
                projectsGrid.appendChild(row);
            });
        }).catch(err => {
            console.error(err);
            const isNoProj = err.message === "No projects";
            projectsGrid.innerHTML = `<p style="padding:60px;text-align:center;color:rgba(${isNoProj ? "247,247,245,0.3" : "220,80,80,0.6"});font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">${isNoProj ? "No projects found." : "Unable to load archive."}</p>`;
        });
    }

    // 7. Contact Form Animation
    const contactForm = document.getElementById('contact-form'), modal = document.getElementById('contact-modal'), env = document.getElementById('envelope-wrapper');
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
});
