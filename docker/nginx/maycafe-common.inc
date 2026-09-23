client_max_body_size 256k;

location = /healthz {
  access_log off;
  add_header Content-Type text/plain;
  return 200 "ok\n";
}

location /assets/ {
  try_files $uri =404;
  expires 1y;
  add_header Cache-Control "public, immutable";
}
