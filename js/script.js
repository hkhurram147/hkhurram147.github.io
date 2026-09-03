document.addEventListener('DOMContentLoaded', function() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    /* ---------------------------------------------------------
       Theme toggle (with a brief cross-fade between palettes)
       --------------------------------------------------------- */
    const themeToggle = document.getElementById('themeToggle');

    function applyThemeIcon() {
        if (!themeToggle) return;
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        themeToggle.innerHTML = dark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    }

    if (themeToggle) {
        applyThemeIcon();
        themeToggle.addEventListener('click', function() {
            const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.classList.add('theme-switching');
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            applyThemeIcon();
            setTimeout(() => document.documentElement.classList.remove('theme-switching'), 500);
        });
    }

    /* ---------------------------------------------------------
       Navigation: smooth scroll, mobile menu
       --------------------------------------------------------- */
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', function(e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                e.preventDefault();
                window.scrollTo({
                    top: target.offsetTop - 84,
                    behavior: prefersReducedMotion ? 'auto' : 'smooth'
                });
            }
        });
    });

    const burger = document.getElementById('burger');
    const navMenu = document.getElementById('navLinks');

    function setMenu(open) {
        if (!burger || !navMenu) return;
        navMenu.classList.toggle('open', open);
        burger.classList.toggle('active', open);
        burger.setAttribute('aria-expanded', String(open));
        document.body.classList.toggle('menu-open', open);
    }

    if (burger && navMenu) {
        burger.addEventListener('click', () => setMenu(!navMenu.classList.contains('open')));
        navMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
    }

    /* ---------------------------------------------------------
       Typed rotating role in the hero
       --------------------------------------------------------- */
    const typedEl = document.getElementById('typedText');
    if (typedEl) {
        const roles = (typedEl.dataset.roles || '').split('|').filter(Boolean);
        if (prefersReducedMotion || roles.length === 0) {
            typedEl.textContent = roles[0] || '';
        } else {
            let roleIndex = 0, charIndex = 0, deleting = false;

            function tick() {
                const role = roles[roleIndex];
                charIndex += deleting ? -1 : 1;
                typedEl.textContent = role.slice(0, charIndex);

                let delay = deleting ? 38 : 75;
                if (!deleting && charIndex === role.length) {
                    delay = 1800;
                    deleting = true;
                } else if (deleting && charIndex === 0) {
                    deleting = false;
                    roleIndex = (roleIndex + 1) % roles.length;
                    delay = 350;
                }
                setTimeout(tick, delay);
            }

            setTimeout(tick, 900);
        }
    }

    /* ---------------------------------------------------------
       Cursor glow + hero parallax (desktop pointers only)
       --------------------------------------------------------- */
    const cursorGlow = document.getElementById('cursorGlow');
    const hero = document.querySelector('.hero');

    if (finePointer && !prefersReducedMotion) {
        if (cursorGlow) {
            let targetX = window.innerWidth / 2, targetY = window.innerHeight / 2;
            let curX = targetX, curY = targetY, glowActive = false;

            window.addEventListener('pointermove', e => {
                targetX = e.clientX;
                targetY = e.clientY;
                if (!glowActive) {
                    glowActive = true;
                    cursorGlow.classList.add('active');
                    requestAnimationFrame(renderGlow);
                }
            }, { passive: true });

            function renderGlow() {
                curX += (targetX - curX) * 0.12;
                curY += (targetY - curY) * 0.12;
                cursorGlow.style.transform = 'translate(' + curX + 'px, ' + curY + 'px)';
                requestAnimationFrame(renderGlow);
            }
        }

        if (hero) {
            hero.addEventListener('mousemove', e => {
                const rect = hero.getBoundingClientRect();
                const px = (e.clientX - rect.left) / rect.width - 0.5;
                const py = (e.clientY - rect.top) / rect.height - 0.5;
                hero.style.setProperty('--px', px.toFixed(3));
                hero.style.setProperty('--py', py.toFixed(3));
            });
            hero.addEventListener('mouseleave', () => {
                hero.style.setProperty('--px', 0);
                hero.style.setProperty('--py', 0);
            });
        }

        // 3D tilt on project cards
        document.querySelectorAll('.project-card').forEach(card => {
            card.addEventListener('mousemove', function(e) {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                card.style.transform =
                    'translateY(-6px) perspective(1000px) rotateX(' + (-y * 4).toFixed(2) +
                    'deg) rotateY(' + (x * 5).toFixed(2) + 'deg)';
                card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
                card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
            });
            card.addEventListener('mouseleave', function() {
                card.style.transform = '';
            });
        });

        // Cursor-tracking spotlight on skill cards and stats
        document.querySelectorAll('.skill-map-card, .stat-item, .education-card, .contact-form').forEach(card => {
            card.addEventListener('mousemove', function(e) {
                const rect = card.getBoundingClientRect();
                card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
                card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
            });
        });
    }

    /* ---------------------------------------------------------
       Split section titles into words for a staggered reveal
       --------------------------------------------------------- */
    document.querySelectorAll('[data-split]').forEach(el => {
        const words = el.textContent.trim().split(/\s+/);
        el.textContent = '';
        words.forEach((word, i) => {
            const wrap = document.createElement('span');
            wrap.className = 'w-wrap';
            const inner = document.createElement('span');
            inner.className = 'w';
            inner.style.setProperty('--i', i);
            inner.textContent = word;
            wrap.appendChild(inner);
            el.appendChild(wrap);
            if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
        });
    });

    /* ---------------------------------------------------------
       Scroll reveal system
       [data-reveal] elements animate in when they enter view.
       [data-stagger] containers reveal their children in sequence.
       --------------------------------------------------------- */
    document.querySelectorAll('[data-stagger]').forEach(container => {
        Array.from(container.children).forEach((child, i) => {
            if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', 'up');
            child.style.setProperty('--d', (i * 90) + 'ms');
        });
    });

    // Index tags inside skill cards so they can pop in one after another
    document.querySelectorAll('.smc-tags').forEach(group => {
        Array.from(group.children).forEach((tag, i) => tag.style.setProperty('--i', i));
    });

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                el.classList.add('is-visible');
                // Drop the stagger delay once the reveal has played so hovers stay instant
                setTimeout(() => el.style.removeProperty('--d'), 1600);
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));

    /* ---------------------------------------------------------
       Animated counters for the stats row
       --------------------------------------------------------- */
    function animateCounter(el) {
        const text = el.textContent.trim();
        const match = text.match(/^(\d+)(.*)$/);
        if (!match || prefersReducedMotion) return;

        const target = parseInt(match[1], 10);
        const suffix = match[2];
        const duration = 1400;
        const start = performance.now();

        function step(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (progress < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    }

    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) {
        new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.querySelectorAll('.stat-number').forEach(animateCounter);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.35 }).observe(statsContainer);
    }

    /* ---------------------------------------------------------
       Expand / collapse: projects and timeline
       --------------------------------------------------------- */
    document.querySelectorAll('.see-more-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const card = this.closest('.project-card');
            card.classList.toggle('expanded');
            const isExpanded = card.classList.contains('expanded');
            this.innerHTML = isExpanded ?
                'See Less <i class="fas fa-chevron-up"></i>' :
                'See More <i class="fas fa-chevron-down"></i>';
        });
    });

    document.querySelectorAll('.timeline-expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const item = this.closest('.timeline-item');
            const willExpand = !item.classList.contains('expanded');

            document.querySelectorAll('.timeline-item.expanded').forEach(other => {
                if (other !== item) {
                    other.classList.remove('expanded');
                    const otherBtn = other.querySelector('.timeline-expand-btn');
                    if (otherBtn) otherBtn.innerHTML = 'View Details <i class="fas fa-chevron-down"></i>';
                }
            });

            item.classList.toggle('expanded', willExpand);
            this.innerHTML = willExpand ?
                'Show Less <i class="fas fa-chevron-up"></i>' :
                'View Details <i class="fas fa-chevron-down"></i>';
        });
    });

    /* ---------------------------------------------------------
       Scroll-driven UI: header, progress bar, active link,
       hero parallax, timeline drawing, back-to-top
       --------------------------------------------------------- */
    const header = document.getElementById('siteHeader');
    const progressBar = document.querySelector('.scroll-progress');
    const backToTop = document.getElementById('backToTop');
    const heroText = document.getElementById('heroText');
    const profileArea = document.getElementById('profileArea');
    const timeline = document.getElementById('timeline');
    const timelineItems = timeline ? Array.from(timeline.querySelectorAll('.timeline-item')) : [];
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-links a');
    let ticking = false;

    function onScroll() {
        const scrollY = window.scrollY;
        const vh = window.innerHeight;

        if (header) header.classList.toggle('scrolled', scrollY > 24);
        if (backToTop) backToTop.classList.toggle('visible', scrollY > 600);

        if (progressBar) {
            const docHeight = document.documentElement.scrollHeight - vh;
            progressBar.style.width = docHeight > 0 ? (scrollY / docHeight) * 100 + '%' : '0%';
        }

        // Hero parallax: text drifts up and fades, portrait drifts slower
        if (!prefersReducedMotion && hero && scrollY < vh) {
            const t = scrollY / vh;
            if (heroText) {
                heroText.style.transform = 'translateY(' + (scrollY * 0.18) + 'px)';
                heroText.style.opacity = String(clamp(1 - t * 1.1, 0, 1));
            }
            if (profileArea) {
                profileArea.style.transform = 'translateY(' + (scrollY * 0.08) + 'px)';
            }
        }

        // Timeline line draws as you scroll through the section
        if (timeline) {
            const rect = timeline.getBoundingClientRect();
            const progress = clamp((vh * 0.65 - rect.top) / rect.height, 0, 1);
            timeline.style.setProperty('--tl-progress', progress.toFixed(4));
            const drawn = progress * rect.height;
            timelineItems.forEach(item => {
                item.classList.toggle('is-reached', item.offsetTop + 24 <= drawn);
            });
        }

        // Active nav link
        let current = '';
        sections.forEach(section => {
            if (scrollY >= section.offsetTop - 160) current = section.id;
        });
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + current);
        });

        ticking = false;
    }

    window.addEventListener('scroll', function() {
        if (!ticking) {
            requestAnimationFrame(onScroll);
            ticking = true;
        }
    }, { passive: true });

    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();

    if (backToTop) {
        backToTop.addEventListener('click', function() {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
        });
    }

    /* ---------------------------------------------------------
       Footer year
       --------------------------------------------------------- */
    document.querySelectorAll('.footer-year').forEach(el => {
        el.textContent = new Date().getFullYear();
    });
});
