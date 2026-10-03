import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Welcome screen shown on first launch.
 * Automatically bypassed so users are not blocked by permission disclosure screens.
 */
@Component({
  selector: 'app-intro',
  templateUrl: './intro.page.html',
  styleUrls: ['./intro.page.scss'],
  standalone: false,
})
export class IntroPage implements OnInit {
  loading = false;
  error: string | null = null;

  constructor(private router: Router) {}

  ngOnInit(): void {
    localStorage.setItem('dreamcabs_permissions_intro_done', '1');
    void this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  async grant(): Promise<void> {
    localStorage.setItem('dreamcabs_permissions_intro_done', '1');
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  async skip(): Promise<void> {
    localStorage.setItem('dreamcabs_permissions_intro_done', '1');
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }
}

