<?php
// Set your email address where you want to receive messages
$receiving_email_address = 'hkhurram122@gmail.com';

// Check if the form was submitted
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Get form data and sanitize
    $name = isset($_POST['name']) ? strip_tags(trim($_POST['name'])) : '';
    $email = isset($_POST['email']) ? filter_var(trim($_POST['email']), FILTER_SANITIZE_EMAIL) : '';
    $message = isset($_POST['message']) ? trim($_POST['message']) : '';

    // Check that required data is present
    if (empty($name) || empty($email) || empty($message) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        // Set a 400 (bad request) response code and exit
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Please complete the form and try again.']);
        exit;
    }

    // Build the email content
    $email_content = "Name: $name\n";
    $email_content .= "Email: $email\n\n";
    $email_content .= "Message:\n$message\n";

    // Build the email headers
    $email_headers = "From: $name <$email>";

    // Send the email
    if (mail($receiving_email_address, "New contact from $name", $email_content, $email_headers)) {
        // Set a 200 (okay) response code
        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Thank You! Your message has been sent.']);
    } else {
        // Set a 500 (internal server error) response code
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Oops! Something went wrong and we couldn\'t send your message.']);
    }
} else {
    // Not a POST request, set a 403 (forbidden) response code
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'There was a problem with your submission, please try again.']);
}
?> 