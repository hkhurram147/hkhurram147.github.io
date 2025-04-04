document.addEventListener('DOMContentLoaded', function() {
    const contactForm = document.getElementById('contactForm');
    const formStatus = document.getElementById('form-status');
    
    if (contactForm) {
        // Use the provided Formspree ID
        contactForm.setAttribute('action', 'https://formspree.io/f/xkgjqnwy');
        contactForm.setAttribute('method', 'POST');
        
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Show sending message
            formStatus.innerHTML = '<p class="sending-message">Sending message...</p>';
            
            // Use Fetch API to submit the form
            fetch(contactForm.action, {
                method: 'POST',
                body: new FormData(contactForm),
                headers: {
                    'Accept': 'application/json'
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.ok) {
                    formStatus.innerHTML = '<p class="success-message">Message sent successfully!</p>';
                    contactForm.reset();
                    
                    // Redirect to thank you page after 2 seconds
                    setTimeout(() => {
                        window.location.href = 'thank-you.html';
                    }, 2000);
                } else {
                    throw new Error('Form submission failed');
                }
            })
            .catch(error => {
                formStatus.innerHTML = '<p class="error-message">Error sending message. Please try again.</p>';
                console.error('Error:', error);
            });
        });
    }
}); 