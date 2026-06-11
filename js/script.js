document.addEventListener('DOMContentLoaded', function() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Smooth scrolling for in-page navigation
    const navLinks = document.querySelectorAll('nav a[href^="#"]');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const targetElement = document.querySelector(this.getAttribute('href'));
            if (targetElement) {
                e.preventDefault();
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: prefersReducedMotion ? 'auto' : 'smooth'
                });
            }
        });
    });

    // Mobile menu toggle
    const burger = document.getElementById('burger');
    const navMenu = document.querySelector('.nav-links');

    if (burger && navMenu) {
        burger.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            burger.classList.toggle('active');
        });

        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                burger.classList.remove('active');
            });
        });
    }

    // Project card expand/collapse
    document.querySelectorAll('.see-more-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const projectCard = this.closest('.project-card');
            projectCard.classList.toggle('expanded');

            const isExpanded = projectCard.classList.contains('expanded');
            this.innerHTML = isExpanded ?
                'See Less <i class="fas fa-chevron-up"></i>' :
                'See More <i class="fas fa-chevron-down"></i>';

            if (isExpanded) {
                setTimeout(() => {
                    const cardRect = projectCard.getBoundingClientRect();
                    if (cardRect.bottom > window.innerHeight) {
                        window.scrollBy({
                            top: Math.min(100, cardRect.bottom - window.innerHeight + 20),
                            behavior: prefersReducedMotion ? 'auto' : 'smooth'
                        });
                    }
                }, 50);
            }
        });
    });

    // Timeline expand/collapse — only one item open at a time
    document.querySelectorAll('.timeline-expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const timelineItem = this.closest('.timeline-item');
            const willExpand = !timelineItem.classList.contains('expanded');

            document.querySelectorAll('.timeline-item.expanded').forEach(item => {
                if (item !== timelineItem) {
                    item.classList.remove('expanded');
                    const expandedBtn = item.querySelector('.timeline-expand-btn');
                    if (expandedBtn) {
                        expandedBtn.innerHTML = 'View Details <i class="fas fa-chevron-down"></i>';
                    }
                }
            });

            timelineItem.classList.toggle('expanded', willExpand);
            this.innerHTML = willExpand ?
                'Show Less <i class="fas fa-chevron-up"></i>' :
                'View Details <i class="fas fa-chevron-down"></i>';
        });
    });

    // Scroll-driven UI: header style, progress bar, active nav link
    const header = document.querySelector('header');
    const progressBar = document.querySelector('.scroll-progress');
    const sections = document.querySelectorAll('section[id]');
    const allNavLinks = document.querySelectorAll('.nav-links a');
    let ticking = false;

    function onScroll() {
        const scrollY = window.scrollY;

        if (header) {
            header.classList.toggle('scrolled', scrollY > 50);
        }

        if (progressBar) {
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            progressBar.style.width = docHeight > 0 ? (scrollY / docHeight) * 100 + '%' : '0%';
        }

        let currentSection = '';
        sections.forEach(section => {
            if (scrollY >= section.offsetTop - 150) {
                currentSection = section.getAttribute('id');
            }
        });

        allNavLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + currentSection);
        });

        ticking = false;
    }

    window.addEventListener('scroll', function() {
        if (!ticking) {
            requestAnimationFrame(onScroll);
            ticking = true;
        }
    }, { passive: true });

    onScroll();

    // Animated counters for the stats row
    function animateCounter(el) {
        const text = el.textContent.trim();
        const match = text.match(/^(\d+)(.*)$/);
        if (!match || prefersReducedMotion) return;

        const target = parseInt(match[1], 10);
        const suffix = match[2];
        const duration = 1200;
        const start = performance.now();

        function step(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (progress < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    }

    const statsObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.querySelectorAll('.stat-number').forEach(animateCounter);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.4 });

    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) statsObserver.observe(statsContainer);

    // Reveal-on-scroll with a small stagger between siblings
    const animateOnScroll = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Drop the stagger delay once revealed so hover effects stay snappy
                setTimeout(() => { entry.target.style.transitionDelay = ''; }, 1100);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.timeline-item, .project-card, .education-card, .skill-map-card').forEach((item, index) => {
        const siblingIndex = Array.prototype.indexOf.call(item.parentElement.children, item);
        item.style.transitionDelay = (Math.min(siblingIndex, 5) * 70) + 'ms';
        animateOnScroll.observe(item);

        if (item.classList.contains('project-card')) {
            item.classList.remove('expanded');
        }
    });

    // Keep the footer year current
    document.querySelectorAll('.footer-year').forEach(el => {
        el.textContent = new Date().getFullYear();
    });
});
