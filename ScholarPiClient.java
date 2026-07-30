import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class ScholarPiClient {
    public static void main(String[] args) {
        // 1. Set up the HTTP Client
        HttpClient client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_2)
                .connectTimeout(Duration.ofSeconds(10))
                .build();

        // 2. Prepare the JSON payload for the Scilem engine
        String jsonPayload = "{\"paper_text\": \"Analyzing the intersection of decentralized ledgers and AI evaluation models.\"}";

        // 3. Build the Request targeting your local FastAPI server
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:8000/api/assess/text"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                .build();

        try {
            // 4. Send the Request and print the Response
            System.out.println("Sending manuscript to ScholarPi backend...");
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            
            System.out.println("Status Code: " + response.statusCode());
            System.out.println("Response Body:\n" + response.body());
            
        } catch (Exception e) {
            System.err.println("Error communicating with ScholarPi API: " + e.getMessage());
        }
    }
}