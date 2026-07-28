<?php

namespace App\Services;

/**
 * The payment-gateway fee the customer pays on top of the fare.
 *
 * Razorpay charges the platform a percentage of every payment it collects (plus
 * 0.1% for the Route split, plus GST on both). Rather than absorb that out of
 * commission, the customer is quoted it as its own line and the platform's
 * commission stays whole.
 *
 * The rate depends on HOW the customer pays — UPI and ordinary cards cost 2%,
 * while Amex, EMI and international cards cost 3%. Razorpay fixes an order's
 * amount before its checkout opens, so the method has to be chosen in our app
 * first and the order created for that method; {@see methods()} is what the
 * customer app renders that chooser from.
 *
 * Everything here is rupees in, rupees out, rounded to paise. Off by default —
 * with the fee disabled every quote and charge is exactly the fare, which is
 * the pre-existing behaviour.
 */
class GatewayFeeService
{
    /** Fallback when the customer's chosen method isn't one we know. */
    public const DEFAULT_METHOD = 'upi';

    public function enabled(): bool
    {
        return (bool) config('services.payments.gateway_fee.enabled', false);
    }

    /**
     * The methods a customer may pick, with the fee each one attracts, ready to
     * render as a chooser. `rate` is the all-in percentage (gateway + Route +
     * GST) purely so the UI can explain itself; the charged figure is always
     * {@see feeFor()}, never recomputed client-side.
     *
     * @return array<int, array{key:string,label:string,hint:string,rate:float}>
     */
    public function methods(): array
    {
        $out = [];
        foreach ((array) config('services.payments.gateway_fee.methods', []) as $key => $cfg) {
            $out[] = [
                'key' => (string) $key,
                'label' => (string) ($cfg['label'] ?? $key),
                'hint' => (string) ($cfg['hint'] ?? ''),
                'rate' => round($this->effectiveRate((string) $key), 4),
            ];
        }

        return $out;
    }

    /** Is this one of the methods we know how to price? */
    public function isKnownMethod(?string $method): bool
    {
        return $method !== null
            && array_key_exists($method, (array) config('services.payments.gateway_fee.methods', []));
    }

    /**
     * The fee on a fare, in rupees. Returns 0.0 while the fee is disabled, so
     * callers can add it unconditionally.
     *
     * An unknown method falls back to the default rate rather than throwing:
     * a mispriced paise is recoverable, refusing to take the payment is not.
     */
    public function feeFor(float $fare, ?string $method = null): float
    {
        if (! $this->enabled() || $fare <= 0) {
            return 0.0;
        }

        $rate = $this->effectiveRate($this->isKnownMethod($method) ? (string) $method : self::DEFAULT_METHOD);

        return round($fare * $rate / 100, 2);
    }

    /**
     * Fare + fee — what the customer is actually charged.
     */
    public function totalFor(float $fare, ?string $method = null): float
    {
        return round($fare + $this->feeFor($fare, $method), 2);
    }

    /**
     * The fare hiding inside a charged total. The inverse of {@see totalFor()},
     * used by the split so the driver's share is worked out on the ride's value
     * and never on Razorpay's cut.
     */
    public function fareFromTotal(float $total, ?string $method = null): float
    {
        if (! $this->enabled() || $total <= 0) {
            return round($total, 2);
        }

        $rate = $this->effectiveRate($this->isKnownMethod($method) ? (string) $method : self::DEFAULT_METHOD);

        return round($total / (1 + $rate / 100), 2);
    }

    /**
     * A quote's fee breakdown, shaped for the customer app's price panel.
     *
     * @return array{enabled:bool,method:string|null,fare:float,fee:float,total:float,rate:float}
     */
    public function breakdown(float $fare, ?string $method = null): array
    {
        $fee = $this->feeFor($fare, $method);

        return [
            'enabled' => $this->enabled(),
            'method' => $this->isKnownMethod($method) ? $method : null,
            'fare' => round($fare, 2),
            'fee' => $fee,
            'total' => round($fare + $fee, 2),
            'rate' => $this->enabled()
                ? round($this->effectiveRate($this->isKnownMethod($method) ? (string) $method : self::DEFAULT_METHOD), 4)
                : 0.0,
        ];
    }

    /**
     * The fee line a fare quote can show BEFORE the customer has picked how
     * they'll pay.
     *
     * {@see breakdown()} needs a method; a quote doesn't have one yet, because
     * the chooser only appears at checkout. So this answers the honest version
     * of the question: what the fee is for the method most people use, and how
     * high it can go if they reach for Amex, EMI or an international card.
     *
     * `fee`/`total` are the default-method figures — safe to show as the
     * headline, since that is what the majority are actually charged. `varies`
     * tells the app whether to bother printing the "up to" caveat at all; when
     * every configured method happens to share a rate, it doesn't.
     *
     * @return array{enabled:bool,fare:float,fee:float,total:float,rate:float,max_fee:float,max_total:float,max_rate:float,varies:bool,default_method:string}
     */
    public function quote(float $fare): array
    {
        $fee = $this->feeFor($fare, self::DEFAULT_METHOD);
        $rate = $this->enabled() ? round($this->effectiveRate(self::DEFAULT_METHOD), 4) : 0.0;

        $rates = array_map(
            fn (array $m) => (float) $m['rate'],
            $this->enabled() ? $this->methods() : [],
        );
        $maxRate = $rates === [] ? $rate : round(max($rates), 4);
        $maxFee = $this->enabled() && $fare > 0 ? round($fare * $maxRate / 100, 2) : 0.0;

        return [
            'enabled' => $this->enabled(),
            'fare' => round($fare, 2),
            'fee' => $fee,
            'total' => round($fare + $fee, 2),
            'rate' => $rate,
            'max_fee' => $maxFee,
            'max_total' => round($fare + $maxFee, 2),
            'max_rate' => $maxRate,
            'varies' => $maxFee > $fee,
            'default_method' => self::DEFAULT_METHOD,
        ];
    }

    /**
     * A method's all-in percentage: the gateway's cut plus the Route split fee,
     * both grossed up by GST. Configured as the headline rates Razorpay quotes,
     * so the numbers in config match the numbers on their pricing page.
     */
    private function effectiveRate(string $method): float
    {
        $cfg = (array) config("services.payments.gateway_fee.methods.{$method}", []);
        $base = (float) ($cfg['rate'] ?? config('services.payments.gateway_fee.default_rate', 2.0));
        $route = (float) config('services.payments.gateway_fee.route_rate', 0.1);
        $gst = (float) config('services.payments.gateway_fee.gst_rate', 18.0);

        return ($base + $route) * (1 + $gst / 100);
    }
}
