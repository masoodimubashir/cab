import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.page.html',
  styleUrls: ['./welcome.page.scss'],
  standalone: false
})
export class WelcomePage implements OnInit {

  constructor(private router: Router) { }

  ngOnInit() {
  }

  useFallbackImage(event: any) {
    // If the image is not found, replace it with a styled div dynamically or hide it
    event.target.style.display = 'none';
    const parent = event.target.parentElement;
    if (parent) {
      const fallback = document.createElement('div');
      fallback.className = 'fallback-img';
      fallback.innerText = 'Illustration Placeholder';
      parent.appendChild(fallback);
    }
  }

  goToLogin() {
    this.router.navigate(['/auth/login']);
  }

  goToTerms() {
    console.log('Navigate to Terms');
  }

  goToPrivacy() {
    console.log('Navigate to Privacy');
  }
}
