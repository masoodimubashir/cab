<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: DejaVu Sans, Arial, sans-serif; color: #111; }
        .container { padding: 24px; }
        .header { display: flex; justify-content: space-between; align-items: baseline; }
        .title { font-size: 20px; font-weight: 700; }
        .muted { color: #666; font-size: 12px; }
        .card { border: 1px solid #eee; padding: 14px; margin-top: 16px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        td, th { border-bottom: 1px solid #f0f0f0; padding: 8px; text-align: left; font-size: 13px; }
        .total { font-size: 16px; font-weight: 700; text-align: right; }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <div>
            <div class="title">DreamCabs</div>
            <div class="muted">Customer Invoice</div>
        </div>
        <div style="text-align:right;">
            <div class="muted">Invoice No</div>
            <div style="font-weight:700;">{{ $invoiceNo }}</div>
        </div>
    </div>

    <div class="card">
        <div style="font-weight:700;">Trip Details</div>
        <table>
            <tr>
                <th>Pickup</th>
                <td>{{ $trip->pickup_address ?? ($trip->pickup_lat . ', ' . $trip->pickup_lng) }}</td>
            </tr>
            <tr>
                <th>Drop</th>
                <td>{{ $trip->drop_address ?? ($trip->drop_lat . ', ' . $trip->drop_lng) }}</td>
            </tr>
            <tr>
                <th>Driver</th>
                <td>{{ optional($trip->driver)->name ?? '-' }}</td>
            </tr>
            <tr>
                <th>Ride Type</th>
                <td>{{ optional($trip->rideType)->name ?? '-' }}</td>
            </tr>
        </table>
    </div>

    <div class="card">
        <div style="font-weight:700;">Payment Summary</div>
        <table>
            <tr>
                <th>Final Fare</th>
                <td class="total">{{ number_format((float) $payment->amount, 2) }} {{ $payment->currency }}</td>
            </tr>
            <tr>
                <th>Payment Method</th>
                <td>{{ $payment->method }}</td>
            </tr>
            <tr>
                <th>Issued At</th>
                <td>{{ $payment->paid_at ? $payment->paid_at->toDateTimeString() : $trip->completed_at?->toDateTimeString() }}</td>
            </tr>
        </table>
    </div>
</div>
</body>
</html>

