import { ApiError } from '../errors/api-error.js';
import { MAX_REPORT_DAYS } from './constants.js';

export interface DateRangeUTC {
    fromUTC: Date;
    toUTC: Date;
}

export function parseReportDateRange(startStr?: string, endStr?: string): DateRangeUTC {
    // 1. Default to the last 30 days ending right now if no dates are passed
    const now = new Date();
    const toUTC = endStr ? new Date(`${endStr}T23:59:59.999+05:45`) : now;
    const fromUTC = startStr
        ? new Date(`${startStr}T00:00:00.000+05:45`)
        : new Date(toUTC.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 2. Reject unparseable date strings (e.g., "2026-99-99")
    if (isNaN(fromUTC.getTime()) || isNaN(toUTC.getTime())) {
        throw new ApiError(400, 'INVALID_DATE', 'Dates must be valid YYYY-MM-DD format');
    }

    // 3. Reject backwards ranges
    if (fromUTC > toUTC) {
        throw new ApiError(400, 'INVALID_DATE_RANGE', 'startDate cannot be after endDate');
    }

    // 4. Enforce the 90-day ceiling
    const daysDifference = (toUTC.getTime() - fromUTC.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDifference > MAX_REPORT_DAYS) {
        throw new ApiError(400, 'DATE_RANGE_TOO_LARGE', `Date range cannot exceed ${MAX_REPORT_DAYS} days`);
    }

    return { fromUTC, toUTC };
}