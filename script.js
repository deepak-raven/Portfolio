
document.addEventListener('DOMContentLoaded', () => {
    const mockup = document.querySelector('.mockup');

    // Add scroll event listener
    window.addEventListener('scroll', () => {
        // If we scroll down more than 50px, close the laptop
        if (window.scrollY > 50) {
            mockup.classList.remove('opened');
            // Adding a closed class if needed for specific styling, though removing opened is usually enough based on CSS
            mockup.classList.add('closed');
        } else {
            // If we are at the top, open the laptop
            mockup.classList.add('opened');
            mockup.classList.remove('closed');
        }
    });

    // Intersection Observer for Scroll Animations
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target); // Only animate once
            }
        });
    }, observerOptions);

    // Observe all elements with reveal-up class
    document.querySelectorAll('.reveal-up').forEach(el => {
        observer.observe(el);
    });

    // Custom Cursor Logic
    const cursorDot = document.createElement('div');
    cursorDot.classList.add('cursor-dot');
    const cursorOutline = document.createElement('div');
    cursorOutline.classList.add('cursor-outline');
    
    // Check if device is a touch device
    if (window.matchMedia("(pointer: fine)").matches) {
        document.body.appendChild(cursorDot);
        document.body.appendChild(cursorOutline);

        window.addEventListener('mousemove', (e) => {
            const posX = e.clientX;
            const posY = e.clientY;
            
            cursorDot.style.left = `${posX}px`;
            cursorDot.style.top = `${posY}px`;
            
            // Adding a slight delay for the outline makes it feel more lively
            cursorOutline.animate({
                left: `${posX}px`,
                top: `${posY}px`
            }, { duration: 500, fill: "forwards" });
        });

        // Add hover effects for links, buttons, and interactive elements
        const hoverElements = document.querySelectorAll('a, button, .cursor-pointer, .mockup, [role="button"]');
        hoverElements.forEach(el => {
            el.addEventListener('mouseenter', () => {
                document.body.classList.add('cursor-hover');
                // Check if element is in a dark section
                if (el.closest('.bg-black')) {
                    document.body.classList.add('cursor-hover-dark');
                }
            });
            el.addEventListener('mouseleave', () => {
                document.body.classList.remove('cursor-hover');
                document.body.classList.remove('cursor-hover-dark');
            });
        });
    }

    // Magnetic Buttons implementation
    const magneticElements = document.querySelectorAll('.magnetic');
    magneticElements.forEach((el) => {
        el.addEventListener('mousemove', (e) => {
            const position = el.getBoundingClientRect();
            const x = e.clientX - position.left - position.width / 2;
            const y = e.clientY - position.top - position.height / 2;
            
            el.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px)`;
            el.style.transition = 'transform 0.1s ease-out';
        });
        
        el.addEventListener('mouseleave', () => {
            el.style.transform = 'translate(0px, 0px)';
            el.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
    });

    // Subtly float images in showcase based on mouse position
    const showcaseImages = document.querySelectorAll('#works img, .image-float-container img');
    document.addEventListener('mousemove', (e) => {
        const xAxis = (window.innerWidth / 2 - e.pageX) / 50;
        const yAxis = (window.innerHeight / 2 - e.pageY) / 50;
        
        showcaseImages.forEach(img => {
            if (img.getBoundingClientRect().top < window.innerHeight && img.getBoundingClientRect().bottom > 0) {
               img.style.transform = `translate(${xAxis}px, ${yAxis}px) scale(1.05)`;
            }
        });
    });
});
