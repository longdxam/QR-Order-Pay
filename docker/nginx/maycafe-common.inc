client_max_body_size 256k;

location = /healthz {
  access_log off;
  add_header Content-Type text/plain;
  return 200 "ok\n";
}

location /assets/ {
  try_files $uri =404;
  expires 1y;
  include /etc/nginx/conf.d/maycafe-security-headers.inc;
  add_header Cache-Control "public, immutable";
}

# index.html và service worker phải được kiểm tra lại mỗi lần để bản deploy mới có hiệu lực ngay.
location = /index.html {
  include /etc/nginx/conf.d/maycafe-security-headers.inc;
  add_header Cache-Control "no-cache" always;
}

location = /sw.js {
  include /etc/nginx/conf.d/maycafe-security-headers.inc;
  add_header Cache-Control "no-cache" always;
}
