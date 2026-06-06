<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A booking/cancellation could not proceed for a business reason (capacity,
 * fare not configured, board pin off-corridor, insufficient balance, …).
 * Self-renders to a clean JSON error with the carried HTTP status.
 */
class ReservationException extends RuntimeException
{
    public function __construct(string $message, public int $status = 422)
    {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage()], $this->status);
    }
}
