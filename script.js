
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
});
