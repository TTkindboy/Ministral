import config from "./config.js";
import {getRateLimit, setRateLimit, isRedisAvailable} from "./redisQueue.js";

// Local fallback for when Redis is not available
const localRateLimits = {};

export const checkRateLimit = async (req, url) => {
    let rateLimited = req.statusCode === 429 || req.headers.location?.startsWith("/auth-error?error=rate_limited");
    if(!rateLimited) try {
        const json = JSON.parse(req.body);
        rateLimited = json.error === "rate_limited";
    } catch(e) {}

    if(rateLimited) {
        let retryAfter = parseInt(req.headers['retry-after']) + 1;
        if(retryAfter) {
            console.log(`I am ratelimited at ${url} for ${retryAfter - 1} more seconds!`);
            if(retryAfter > config.rateLimitCap) {
                console.log(`Delay higher than rateLimitCap, setting it to ${config.rateLimitCap} seconds instead`);
                retryAfter = config.rateLimitCap;
            }
        }
        else {
            retryAfter = config.rateLimitBackoff;
            console.log(`I am temporarily ratelimited at ${url} (no ETA given, waiting ${config.rateLimitBackoff}s)`);
        }

        const retryAt = Date.now() + retryAfter * 1000;
        
        // Store in Redis if available, otherwise local fallback
        if (isRedisAvailable()) {
            await setRateLimit(url, retryAt);
        } else {
            localRateLimits[url] = retryAt;
        }
        
        return retryAt;
    }

    return false;
}

export const isRateLimited = async (url) => {
    // Check Redis first if available
    let retryAt;
    if (isRedisAvailable()) {
        retryAt = await getRateLimit(url);
    } else {
        retryAt = localRateLimits[url];
    }

    if(!retryAt) return false;

    if(retryAt < Date.now()) {
        // Rate limit expired, clean up
        if (!isRedisAvailable()) {
            delete localRateLimits[url];
        }
        // Redis keys auto-expire via TTL, no cleanup needed
        return false;
    }

    const retryAfter = (retryAt - Date.now()) / 1000;
    console.log(`I am still ratelimited at ${url} for ${retryAfter} more seconds!`);

    return retryAt;
}
