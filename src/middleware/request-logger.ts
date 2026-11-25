import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
    // 1. If the client or upstream proxy already sent an X-Request-ID, use it;
    // otherwise generate a brand-new cryptographic UUID.
    const requestId = (req.header('x-request-id') as string) || randomUUID();

    // Attach it to incoming headers so downstream code can read it
    req.headers['x-request-id'] = requestId;
    // Send it back in the HTTP response headers so the client sees it
    res.setHeader('X-Request-ID', requestId);

    // 2. Start a high-resolution performance timer
    const start = performance.now();

    // 3. Listen for the 'finish' event (fires when Express finishes sending the response)
    res.on('finish', () => {
        const durationMs = Math.round(performance.now() - start);

        // 4. Build a structured JSON object (easy for tools like Datadog/CloudWatch to search)
        const logEntry = {
            timestamp: new Date().toISOString(),
            requestId,
            method: req.method,
            path: req.originalUrl || req.url,
            statusCode: res.statusCode,
            durationMs,
            ip: req.ip,
            userAgent: req.header('user-agent'),
            // REDACTION RULE: Notice we DO NOT include req.body or Authorization header here!
        };

        const output = JSON.stringify(logEntry);

        // 5. Categorize output stream by HTTP status
        if (res.statusCode >= 500) {
            console.error(output); // Server crashes -> stderr
        } else if (res.statusCode >= 400) {
            console.warn(output);  // Bad user inputs -> stdout (warn)
        } else {
            console.log(output);   // Successful requests -> stdout (info)
        }
    });

    // 6. Pass control to the next middleware / route handler
    next();
}