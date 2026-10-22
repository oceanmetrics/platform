## Draw: first tile and full draw (median of 3 cold page loads, 1280x800)

| file | source | view | first tile ms | full draw ms | bytes | requests | tiles | note |
|---|---|---|---:|---:|---:|---:|---:|---|
| score_risk | 4326 S3 (as published) | world | 670 | 928 | 132,643 | 2 | 4 | placed in ±0.0016° at 0,0 (misplaced) |
| score_risk | 4326 S3 (as published) | z8 | none | 679 | 66,319 | 1 | 0 | placed in ±0.0016° at 0,0 (misplaced) |
| score_risk | 3857 copy, local | world | 68 | 164 | 395,101 | 5 | 24 |  |
| score_risk | 3857 copy, local | z8 | 66 | 69 | 131,824 | 2 | 1 |  |
| score_risk | 3857 copy, local + S3-like network | world | 360 | 789 | 395,101 | 5 | 24 |  |
| score_risk | 3857 copy, local + S3-like network | z8 | 358 | 360 | 131,824 | 2 | 1 |  |
| am_native | 4326 S3 (as published) | world | 506 | 521 | 56,706 | 1 | 4 | placed in ±0.0016° at 0,0 (misplaced) |
| am_native | 4326 S3 (as published) | z8 | none | 529 | 56,686 | 1 | 0 | placed in ±0.0016° at 0,0 (misplaced) |
| am_native | 3857 copy, local | world | 22 | 55 | 88,602 | 2 | 18 |  |
| am_native | 3857 copy, local | z8 | 40 | 48 | 88,602 | 2 | 1 |  |
| am_native | 3857 copy, local + S3-like network | world | 170 | 338 | 88,602 | 2 | 18 |  |
| am_native | 3857 copy, local + S3-like network | z8 | 319 | 323 | 88,602 | 2 | 1 |  |
| mst | 4326 S3 (as published) | world | 545 | 567 | 51,268 | 1 | 4 | placed in ±0.0016° at 0,0 (misplaced) |
| mst | 4326 S3 (as published) | z8 | none | 517 | 51,248 | 1 | 0 | placed in ±0.0016° at 0,0 (misplaced) |
| mst | 3857 copy, local | world | 37 | 51 | 65,905 | 1 | 12 |  |
| mst | 3857 copy, local | z8 | 25 | 37 | 87,152 | 2 | 1 |  |
| mst | 3857 copy, local + S3-like network | world | 171 | 190 | 65,905 | 1 | 12 |  |
| mst | 3857 copy, local + S3-like network | z8 | 327 | 330 | 87,152 | 2 | 1 |  |

## Legend histogram: whole smallest overview with geotiff.js (median of 3 cold loads)

| file | source | image read | ms | bytes | requests |
|---|---|---|---:|---:|---:|
| score_risk | 4326 S3 | 450x225 (image 4) | 758 | 81,920 | 2 |
| score_risk | 3857 copy, local + S3-like network | 256x256 (image 5) | 479 | 49,152 | 2 |
| am_native | 4326 S3 | 180x70 (image 2) | 418 | 16,384 | 1 |
| am_native | 3857 copy, local + S3-like network | 256x192 (image 2) | 303 | 16,384 | 1 |
| mst | 4326 S3 | 7200x1563 (image 0) | 827 | 50,515 | 4 |
| mst | 3857 copy, local + S3-like network | 256x72 (image 5) | 297 | 16,384 | 1 |

## Statistics agreement, band 1 (reference: GDAL over every full-resolution pixel of the 4326 original)

| file | method | min | max | mean | stddev | valid % | mean err % | sd err % | hist TVD % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| score_risk | GDAL full res 4326 (reference) | 0 | 88 | 2.957 | 9.249 | 62.69 | +0.00 | +0.00 | 0.00 |
| score_risk | geotiff.js smallest overview, 4326 S3 (450x225) | 0 | 85 | 3.828 | 10.518 | 66.52 | +29.43 | +13.72 | 4.07 |
| score_risk | geotiff.js smallest overview, 3857 copy, local + S3-like network (256x256) | 0 | 87 | 2.285 | 7.559 | 56.08 | -22.73 | -18.27 | 2.40 |
| score_risk | GDAL same overview 4326 (450x225) | 0 | 85 | 3.828 | 10.518 | 66.52 | +29.43 | +13.72 | 4.07 |
| score_risk | GDAL full res 3857 copy | 0 | 90 | 2.282 | 7.538 | 55.99 | -22.84 | -18.50 | n/a |
| score_risk | titiler /cog/statistics max_size=1024 (613 ms) | 0 | 87 | 3.468 | 10.108 | 64.84 | +17.28 | +9.29 | 2.43 |
| score_risk | titiler /cog/statistics max_size=7200 (43812 ms) | 0 | 88 | 2.957 | 9.249 | 62.69 | +0.00 | +0.00 | 0.00 |
| am_native | GDAL full res 4326 (reference) | 1 | 100 | 81.235 | 27.069 | 61.49 | +0.00 | +0.00 | 0.00 |
| am_native | geotiff.js smallest overview, 4326 S3 (180x70) | 1 | 100 | 81.019 | 27.169 | 61.29 | -0.27 | +0.37 | 1.39 |
| am_native | geotiff.js smallest overview, 3857 copy, local + S3-like network (256x192) | 1 | 100 | 75.756 | 30.476 | 40.62 | -6.74 | +12.59 | 8.09 |
| am_native | GDAL same overview 4326 (180x70) | 1 | 100 | 81.019 | 27.169 | 61.29 | -0.27 | +0.37 | 1.39 |
| am_native | GDAL full res 3857 copy | 1 | 100 | 75.883 | 30.411 | 40.56 | -6.59 | +12.35 | n/a |
| am_native | titiler /cog/statistics max_size=1024 (392 ms) | 1 | 100 | 81.235 | 27.069 | 61.49 | +0.00 | +0.00 | 0.00 |
| am_native | titiler /cog/statistics max_size=720 (137 ms) | 1 | 100 | 81.235 | 27.069 | 61.49 | +0.00 | +0.00 | 0.00 |
| mst | GDAL full res 4326 (reference) | 15 | 100 | 82.934 | 26.950 | 3.85 | +0.00 | +0.00 | 0.00 |
| mst | geotiff.js smallest overview, 4326 S3 (7200x1563) | 15 | 100 | 82.934 | 26.950 | 3.85 | +0.00 | -0.00 | 0.00 |
| mst | geotiff.js smallest overview, 3857 copy, local + S3-like network (256x72) | 18 | 100 | 77.754 | 29.362 | 3.73 | -6.25 | +8.95 | 9.22 |
| mst | GDAL full res 3857 copy | 15 | 100 | 77.712 | 29.272 | 3.73 | -6.30 | +8.61 | n/a |
| mst | titiler /cog/statistics max_size=1024 (365 ms) | 17 | 100 | 82.847 | 26.996 | 3.84 | -0.10 | +0.17 | 6.07 |
| mst | titiler /cog/statistics max_size=7200 (1317 ms) | 15 | 100 | 82.934 | 26.950 | 3.85 | +0.00 | +0.00 | 0.00 |

## score_risk, all 9 bands: geotiff.js smallest 4326 overview (450x225) vs GDAL full res

| band | name | full mean | overview mean | mean err % | full valid % | overview valid % | hist TVD % |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | all | 2.957 | 3.828 | +29.4 | 62.69 | 66.52 | 4.07 |
| 2 | fish | 3.567 | 4.825 | +35.3 | 62.15 | 66.07 | 3.38 |
| 3 | hardCorals | 2.393 | 3.097 | +29.4 | 54.25 | 57.15 | 2.53 |
| 4 | mangroves | 0.000 | 0.000 | +nan | 0.36 | 0.84 | 0.00 |
| 5 | marineMammals | 3.524 | 4.397 | +24.8 | 61.79 | 65.37 | 3.23 |
| 6 | seabirds | no valid pixel | 0 valid | | 0.00 | 0.00 | |
| 7 | seagrasses | no valid pixel | 0 valid | | 0.00 | 0.00 | |
| 8 | seaTurtles | 5.828 | 7.003 | +20.2 | 29.92 | 32.28 | 6.64 |
| 9 | n_eov | 3.325 | 3.316 | -0.3 | 62.69 | 66.52 | 1.77 |

## score_risk band 1: error by overview level (GDAL, 4326 original and 3857 copy)

| crs | image | mean err % | sd err % | valid % err (points) | hist TVD % |
|---|---|---:|---:|---:|---:|
| 4326 | 7200x3600 | +0.00 | +0.00 | +0.00 | 0.00 |
| 4326 | 3600x1800 | +4.05 | +2.51 | +0.46 | 0.49 |
| 4326 | 1800x900 | +9.52 | +5.54 | +1.10 | 1.14 |
| 4326 | 900x450 | +17.52 | +9.39 | +2.15 | 2.25 |
| 4326 | 450x225 | +29.43 | +13.72 | +3.84 | 4.07 |
| 3857 | 8192x8192 | -22.84 | -18.50 | -6.70 | n/a |
| 3857 | 4096x4096 | -22.85 | -18.51 | -6.70 | 2.70 |
| 3857 | 2048x2048 | -22.82 | -18.48 | -6.70 | 2.70 |
| 3857 | 1024x1024 | -22.81 | -18.42 | -6.69 | 2.70 |
| 3857 | 512x512 | -22.69 | -18.41 | -6.71 | 2.70 |
| 3857 | 256x256 | -22.73 | -18.27 | -6.61 | 2.67 |

## View statistics (window of the overview closest to the screen, median of 3)

| file | view | source | options | image | window px | ms total | ms read | bytes | requests |
|---|---|---|---|---|---|---:|---:|---:|---:|
| score_risk | world | 4326 S3 | {} | 900x450 | 900x368 | 1212 | 756 | 245,760 | 3 |
| score_risk | world | 4326 S3 | {"band": 1} | 900x450 | 900x368 | 959 | 529 | 245,760 | 3 |
| score_risk | world | 4326 S3 | {"band": 1, "pool": true} | 900x450 | 900x368 | 981 | 554 | 245,760 | 3 |
| score_risk | world | 3857 copy, local + S3-like network | {} | 1024x1024 | 1024x650 | 2141 | 1956 | 327,680 | 14 |
| score_risk | world | 3857 copy, local + S3-like network | {"band": 1} | 1024x1024 | 1024x650 | 2122 | 1950 | 327,680 | 14 |
| score_risk | world | 3857 copy, local + S3-like network | {"band": 1, "pool": true} | 1024x1024 | 1024x650 | 1978 | 1807 | 327,680 | 14 |
| score_risk | z8 | 4326 S3 | {} | 7200x3600 | 71x37 | 680 | 271 | 98,304 | 2 |
| score_risk | z8 | 4326 S3 | {"band": 1} | 7200x3600 | 71x37 | 688 | 271 | 98,304 | 2 |
| score_risk | z8 | 4326 S3 | {"band": 1, "pool": true} | 7200x3600 | 71x37 | 701 | 293 | 98,304 | 2 |
| score_risk | z8 | 3857 copy, local + S3-like network | {} | 8192x8192 | 81x51 | 475 | 308 | 65,536 | 2 |
| score_risk | z8 | 3857 copy, local + S3-like network | {"band": 1} | 8192x8192 | 81x51 | 471 | 304 | 65,536 | 2 |
| score_risk | z8 | 3857 copy, local + S3-like network | {"band": 1, "pool": true} | 8192x8192 | 81x51 | 349 | 180 | 65,536 | 2 |
| am_native | world | 4326 S3 | {} | 720x283 | 720x283 | 832 | 432 | 55,925 | 4 |
| am_native | world | 3857 copy, local + S3-like network | {} | 1024x768 | 1024x639 | 861 | 707 | 71,476 | 5 |
| am_native | z8 | 4326 S3 | {} | 720x283 | 8x5 | 562 | 151 | 39,541 | 2 |
| am_native | z8 | 3857 copy, local + S3-like network | {} | 1024x768 | 11x7 | 443 | 298 | 38,708 | 2 |
| mst | world | 4326 S3 | {} | 7200x1563 | 7200x1563 | 873 | 438 | 50,515 | 4 |
| mst | world | 3857 copy, local + S3-like network | {} | 1024x288 | 1024x288 | 304 | 160 | 16,384 | 1 |
| mst | z8 | 4326 S3 | {} | 7200x1563 | 71x40 | 552 | 156 | 32,768 | 2 |
| mst | z8 | 3857 copy, local + S3-like network | {} | 8192x2304 | 81x51 | 440 | 295 | 32,768 | 2 |

## Point reads (cold = first read in a fresh page, warm = a second point 0.3° away)

| file | method | values | cold ms | warm ms | cold bytes |
|---|---|---|---:|---:|---:|
| score_risk | protocol locationValues, 3857 copy, S3-like | 30,96,0,nd,12,nd,nd,12,4 | 371 | 0 | 131,824 |
| score_risk | geotiff.js window, 3857 copy, S3-like | 30,96,0,nd,12,nd,nd,12,4 | 478 | 3 | 66,288 |
| score_risk | geotiff.js window, 4326 S3 | 30,96,0,nd,12,nd,nd,12,4 | 711 | 7 | 99,838 |
| score_risk | titiler /cog/point (Node fetch) | 30,96,0,nd,12,nd,nd,12,4 | 127 | n/a | 0 |
| am_native | protocol locationValues, 3857 copy, S3-like | 91 | 313 | 0 | 88,602 |
| am_native | geotiff.js window, 3857 copy, S3-like | 91 | 444 | 2 | 39,450 |
| am_native | geotiff.js window, 4326 S3 | 91 | 566 | 1 | 41,107 |
| am_native | titiler /cog/point (Node fetch) | 91 | 127 | n/a | 0 |
| mst | protocol locationValues, 3857 copy, S3-like | 100 | 331 | 0 | 87,152 |
| mst | geotiff.js window, 3857 copy, S3-like | 100 | 444 | 1 | 33,510 |
| mst | geotiff.js window, 4326 S3 | 100 | 555 | 1 | 34,278 |
| mst | titiler /cog/point (Node fetch) | 100 | 123 | n/a | 0 |
