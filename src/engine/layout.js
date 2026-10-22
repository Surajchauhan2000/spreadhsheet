export const DEFAULT_COL_W = 100
export const DEFAULT_ROW_H = 24
export const MIN_SIZE = 12

// offsets[i] = pixel where item i starts; offsets[count] = total size.
export function createAxis(count, sizeOf) {
    const offsets = new Float64Array(count + 1)
    for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + sizeOf(i)

    // Index of the item containing pixel px (binary search, O(log n)).
    function indexAt(px) {
        if (px <= 0 || count === 0) return 0
        let lo = 0, hi = count // first i whose start is > px
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (offsets[mid] > px) hi = mid
            else lo = mid + 1
        }
        return Math.min(Math.max(lo - 1, 0), count - 1)
    }

    function visibleRange(scroll, viewport, overscan = 3) {
        if (count === 0) return { first: 0, last: -1 }
        return {
            first: Math.max(0, indexAt(scroll) - overscan),
            last: Math.min(count - 1, indexAt(scroll + viewport) + overscan),
        }
    }

    return {
        count,
        total: offsets[count],
        offsetOf: (i) => offsets[i],
        sizeOf: (i) => offsets[i + 1] - offsets[i],
        indexAt,
        visibleRange,
    }
}