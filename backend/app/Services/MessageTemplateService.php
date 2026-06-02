<?php

namespace App\Services;

/**
 * Tiny {{token}} renderer for operator-configurable notification copy
 * (Operator Settings → Templates). Tokens present in $vars are substituted;
 * any unsupplied {{token}} is stripped so raw placeholders never leak to a
 * customer. Tolerant of optional whitespace inside the braces.
 */
class MessageTemplateService
{
    public function render(?string $template, array $vars): string
    {
        if ($template === null || trim($template) === '') {
            return '';
        }

        $rendered = preg_replace_callback(
            '/\{\{\s*([\w.]+)\s*\}\}/',
            fn (array $m): string => array_key_exists($m[1], $vars) ? (string) ($vars[$m[1]] ?? '') : '',
            $template,
        );

        // Collapse runs of spaces/tabs left behind by removed tokens (keep newlines).
        $rendered = preg_replace('/[ \t]{2,}/', ' ', $rendered);

        return trim($rendered);
    }
}
