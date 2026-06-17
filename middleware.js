import { NextResponse } from 'next/server';

export function middleware(request) {
    const url = request.nextUrl;

    // Only the /api/v1/* family is proxied upstream. Note the matcher below never
    // includes the local-first routes (/api/local-ai/*, /api/assets/*), so those are
    // never touched by this middleware regardless of key state.
    if (!url.pathname.startsWith('/api/v1')) {
        return NextResponse.next();
    }

    // Exclude paths that have their own dedicated route handlers with custom logic.
    const isHandledByRoute = url.pathname.startsWith('/api/v1/creative-agent') ||
                            url.pathname.startsWith('/api/v1/get_upload_url') ||
                            url.pathname.startsWith('/api/v1/upload-binary');
    if (isHandledByRoute) {
        return NextResponse.next();
    }

    // Cloud (MuAPI) is optional/legacy: only proxy upstream when the request carries a
    // MuAPI key — the cookie set by the shell, or the x-api-key header from the client.
    // With no key the rewrite is a no-op, so local-first usage never reaches api.muapi.ai.
    const hasMuApiKey = Boolean(
        request.cookies.get('muapi_key')?.value || request.headers.get('x-api-key')
    );
    if (!hasMuApiKey) {
        return NextResponse.next();
    }

    const targetUrl = new URL(url.pathname + url.search, 'https://api.muapi.ai');
    return NextResponse.rewrite(targetUrl);
}

// Match the paths we want to proxy
export const config = {
    matcher: [
        '/api/workflow/:path*', 
        '/api/app/:path*',
        '/api/v1/:path*'
    ],
};
