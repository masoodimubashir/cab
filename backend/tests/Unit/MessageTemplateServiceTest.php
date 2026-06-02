<?php

namespace Tests\Unit;

use App\Services\MessageTemplateService;
use PHPUnit\Framework\TestCase;

class MessageTemplateServiceTest extends TestCase
{
    public function test_replaces_known_tokens_and_strips_unknown(): void
    {
        $svc = new MessageTemplateService();

        $out = $svc->render(
            'Hi {{customer_name}}, your driver {{driver_name}} is on the way. {{eta}}',
            ['customer_name' => 'Priya', 'driver_name' => 'Aamir'],
        );

        // Known tokens filled; the unsupplied {{eta}} is stripped (no raw token).
        $this->assertSame('Hi Priya, your driver Aamir is on the way.', $out);
    }

    public function test_tolerates_whitespace_and_blank_templates(): void
    {
        $svc = new MessageTemplateService();

        $this->assertSame('Hello Priya', $svc->render('Hello {{ customer_name }}', ['customer_name' => 'Priya']));
        $this->assertSame('', $svc->render(null, []));
        $this->assertSame('', $svc->render('   ', []));
    }

    public function test_value_with_special_chars_is_inserted_literally(): void
    {
        $svc = new MessageTemplateService();

        // Backreference-style values must not be interpreted by the engine.
        $out = $svc->render('Code {{code}}', ['code' => '$1 \\2 100%']);
        $this->assertSame('Code $1 \\2 100%', $out);
    }
}
