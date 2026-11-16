import { ApiError } from '../errors/api-error.js'

const MAX_DATABASE_INT = 2_147_483_647

export function checkedMoney(amount: number): number {
    if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        amount > MAX_DATABASE_INT
    ) {
        throw new ApiError(
            422,
            'ORDER_AMOUNT_OUT_OF_RANGE',
            'Order amount exceeds the supported whole-NPR range'
        )
    }
    return amount
}

function roundedPercentage(amount: number, basisPoints: number) {
    return Math.floor((amount * basisPoints + 5000) / 10_000)
}

export function calculateTotals(lineTotals: number[]) {
    const subtotal = checkedMoney(
        lineTotals.reduce((sum, lineTotal) => sum + lineTotal, 0)
    )
    const discount = subtotal >= 5000 ? roundedPercentage(subtotal, 1000) : 0
    const taxableAmount = subtotal - discount
    const tax = roundedPercentage(taxableAmount, 500)
    const total = checkedMoney(taxableAmount + tax)

    return { subtotal, discount, tax, total }
}
