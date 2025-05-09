document.addEventListener('DOMContentLoaded', function() {
    // Navigation links smooth scrolling - simplified for performance
    const navLinks = document.querySelectorAll('nav a[href^="#"]');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                // Use instant scrolling without animation
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: 'auto'
                });
            }
        });
    });

    // Mobile menu toggle - simplified
    const menuToggle = document.querySelector('.mobile-menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');
    
    if (menuToggle && mobileMenu) {
        menuToggle.addEventListener('click', function() {
            mobileMenu.classList.toggle('active');
        });
    }

    // Education card expand functionality - only on button click
    const educationCards = document.querySelectorAll('.education-card');
    educationCards.forEach(card => {
        const expandBtn = card.querySelector('.education-expand-btn');
        if (expandBtn) {
            expandBtn.addEventListener('click', function() {
                // Simply toggle class without animations
                card.classList.toggle('education-expanded');
                
                // Update button text
                const isExpanded = card.classList.contains('education-expanded');
                this.innerHTML = isExpanded ? 
                    'Show Less <i class="fas fa-chevron-up"></i>' : 
                    'View Key Courses <i class="fas fa-chevron-down"></i>';
            });
        }
    });

    // Project card expand functionality - now for see-more-btn
    const seeMoreBtns = document.querySelectorAll('.see-more-btn');
    console.log('Found', seeMoreBtns.length, 'See More buttons');
    seeMoreBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const projectCard = this.closest('.project-card');
            projectCard.classList.toggle('expanded');
            
            // Update button text
            const isExpanded = projectCard.classList.contains('expanded');
            this.innerHTML = isExpanded ? 
                'See Less <i class="fas fa-chevron-up"></i>' : 
                'See More <i class="fas fa-chevron-down"></i>';
            
            console.log('Toggled project card expanded state:', isExpanded);
        });
    });

    // Make project cards visible by default
    document.querySelectorAll('.project-card').forEach(card => {
        card.classList.add('visible');
    });

    // Skills section expand button functionality
    const skillsExpandBtns = document.querySelectorAll('.skills-expand-btn');
    skillsExpandBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const skillsGrid = this.previousElementSibling;
            skillsGrid.classList.toggle('expanded');
            this.classList.toggle('expanded');
            
            // Update button text
            const isExpanded = skillsGrid.classList.contains('expanded');
            this.innerHTML = isExpanded ? 
                'Show Less <i class="fas fa-chevron-up"></i>' : 
                'Show More <i class="fas fa-chevron-down"></i>';
        });
    });

    // Timeline expand functionality
    const timelineExpandBtns = document.querySelectorAll('.timeline-expand-btn');
    timelineExpandBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const timelineItem = this.closest('.timeline-item');
            timelineItem.classList.toggle('expanded');
            
            // Update button text
            const isExpanded = timelineItem.classList.contains('expanded');
            this.innerHTML = isExpanded ? 
                'Show Less <i class="fas fa-chevron-up"></i>' : 
                'See More <i class="fas fa-chevron-down"></i>';
        });
    });

    // Handle header style on scroll - simplified
    const header = document.querySelector('header');
    if (header) {
        window.addEventListener('scroll', function() {
            // Simply add/remove class without transitions
            if (window.scrollY > 50) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        });
    }

    // Update active navigation link on scroll
    function updateActiveNavLink() {
        const sections = document.querySelectorAll('section');
        const navLinks = document.querySelectorAll('.nav-links a');
        
        let currentSection = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            
            // Add buffer to make activation happen slightly before the section top
            if (window.scrollY >= (sectionTop - 150)) {
                currentSection = section.getAttribute('id');
            }
        });
        
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${currentSection}`) {
                link.classList.add('active');
            }
        });
    }
    
    // Run on scroll and on page load
    window.addEventListener('scroll', updateActiveNavLink);
    window.addEventListener('DOMContentLoaded', updateActiveNavLink);

    // Enable scroll animations for timeline/boxes
    // This will handle showing elements as they come into view when scrolling
    
    // IntersectionObserver to animate elements when they come into view
    const animateOnScroll = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Once the animation is triggered, no need to observe anymore
                observer.unobserve(entry.target);
            }
        });
    }, {
        root: null, // viewport
        threshold: 0.1, // 10% of the item is visible
        rootMargin: '0px'
    });
    
    // Observe timeline items, project cards, and other animated elements
    document.querySelectorAll('.timeline-item, .project-card, .skill-category, .education-card').forEach(item => {
        animateOnScroll.observe(item);
        
        // Ensure project cards don't start expanded
        if (item.classList.contains('project-card')) {
            item.classList.remove('expanded');
        }
    });
    
    // Explicitly ensure all project expanded contents are initially hidden
    document.querySelectorAll('.project-expanded-content').forEach(content => {
        content.style.display = 'none';
    });

    // Contact form submission handling
    const contactForm = document.getElementById('contactForm');
    const formStatus = document.getElementById('form-status');
    
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault(); // Prevent default form submission
            
            // Show sending message
            formStatus.innerHTML = '<p class="sending-message">Sending message...</p>';
            
            // Get form data
            const formData = new FormData(this);
            
            // Send AJAX request
            fetch('process-form.php', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    formStatus.innerHTML = '<p class="success-message">Message sent successfully!</p>';
                    contactForm.reset();
                    // Redirect to thank you page after 2 seconds
                    setTimeout(() => {
                        window.location.href = 'thank-you.html';
                    }, 2000);
                } else {
                    formStatus.innerHTML = '<p class="error-message">Error: ' + data.message + '</p>';
                }
            })
            .catch(error => {
                formStatus.innerHTML = '<p class="error-message">Error sending message. Please try again.</p>';
                console.error('Error:', error);
            });
        });
    }
}); 