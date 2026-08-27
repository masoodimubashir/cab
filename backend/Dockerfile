# ===========================================================================
# DreamCabs backend image — PHP 8.3-FPM with everything Laravel 13 + Reverb need.
# One image is reused for three roles (web/php-fpm, reverb, queue) so behaviour
# is identical across them. Build once, run many.
# ===========================================================================
FROM php:8.3-fpm-bookworm

# --- System libs + PHP extensions -----------------------------------------
# docker-php-extension-installer handles the fiddly configure flags for us.
ADD https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
RUN chmod +x /usr/local/bin/install-php-extensions && \
    install-php-extensions \
      pdo_mysql \
      mbstring \
      bcmath \
      gmp \
      gd \
      zip \
      exif \
      intl \
      pcntl \
      opcache \
      redis

# Composer (copied from the official image — always current & verified).
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# --- PHP-FPM + opcache tuning ---------------------------------------------
COPY deploy/php.ini /usr/local/etc/php/conf.d/zz-dreamcabs.ini
COPY deploy/fpm-pool.conf /usr/local/etc/php-fpm.d/zz-dreamcabs.conf

# --- App code -------------------------------------------------------------
# Copy composer files first so `composer install` is cached across code edits.
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

COPY . .
RUN composer dump-autoload --optimize --no-dev --no-scripts && \
    mkdir -p storage/framework/{sessions,views,cache} storage/logs bootstrap/cache && \
    chown -R www-data:www-data storage bootstrap/cache && \
    chmod -R 775 storage bootstrap/cache

# Entry point runs migrations + caches config on container start (web role only).
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["php-fpm"]
