
### vsync, es (101,859 cells)

| view | variant | first draw ms | mean ms | p95 ms | p95 / A | max ms | dropped | frames with tiles missing | settle ms | long tasks ms | heap MB main + workers | data KB load + motion |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fiji | A deck.gl | 578 | 16.7 | 16.7 | 1.00 | 17 | 0 | 0 | 0 | 0 | 30.4 + 1.1 | 478 + 0 |
| fiji | B h3j, main thread | 153 | 16.7 | 16.7 | 1.00 | 17 | 0 | 7 | 15 | 0 | 10.7 + 1.8 | 478 + 0 |
| fiji | C h3j PMTiles, main thread | 106 | 16.7 | 16.7 | 1.00 | 17 | 0 | 8 | 13 | 0 | 6.4 + 1.8 | 32 + 15 |
| fiji | B-w h3j, in worker | 169 | 16.7 | 16.8 | 1.01 | 17 | 0 | 8 | 17 | 0 | 4.6 + 7.9 | 478 + 0 |
| fiji | C-w h3j PMTiles, in worker | 113 | 16.7 | 16.7 | 1.00 | 17 | 0 | 8 | 16 | 0 | 4.6 + 3 | 32 + 15 |
| world | A deck.gl | 567 | 16.7 | 16.7 | 1.00 | 17 | 0 | 0 | 0 | 0 | 30.3 + 1.1 | 478 + 0 |
| world | B h3j, main thread | 477 | 17.9 | 16.8 | 1.01 | 133 | 21 | 14 | 22 | 264 | 10.8 + 5.2 | 478 + 0 |
| world | C h3j PMTiles, main thread | 442 | 17.7 | 16.8 | 1.01 | 100 | 17 | 19 | 16 | 265 | 6.3 + 5.2 | 556 + 866 |
| world | B-w h3j, in worker | 599 | 16.7 | 16.7 | 1.00 | 17 | 0 | 43 | 15 | 0 | 4.5 + 11.3 | 478 + 0 |
| world | C-w h3j PMTiles, in worker | 543 | 16.7 | 16.7 | 1.00 | 17 | 0 | 42 | 15 | 0 | 4.6 + 6.3 | 556 + 866 |
| world | B-w, 3 workers | 385 | 16.7 | 16.7 | 1.00 | 17 | 0 | 32 | 17 | 0 | 4.5 + 26.7 | 1434 + 0 |
| world | C-w, 3 workers | 315 | 16.7 | 16.7 | 1.00 | 17 | 0 | 32 | 17 | 0 | 4.6 + 11.7 | 588 + 854 |

### vsync, n (676,874 cells)

| view | variant | first draw ms | mean ms | p95 ms | p95 / A | max ms | dropped | frames with tiles missing | settle ms | long tasks ms | heap MB main + workers | data KB load + motion |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fiji | A deck.gl | 3231 | 16.7 | 16.7 | 1.00 | 17 | 0 | 0 | 0 | 0 | 163.9 + 1.1 | 2533 + 0 |
| fiji | B h3j, main thread | 458 | 16.7 | 16.7 | 1.00 | 17 | 0 | 10 | 18 | 0 | 36.8 + 2.2 | 2533 + 0 |
| fiji | C h3j PMTiles, main thread | 148 | 16.7 | 16.7 | 1.00 | 17 | 0 | 11 | 18 | 0 | 6.6 + 2.2 | 94 + 60 |
| fiji | B-w h3j, in worker | 483 | 16.7 | 16.7 | 1.00 | 17 | 0 | 11 | 18 | 0 | 4.7 + 34.2 | 2533 + 0 |
| fiji | C-w h3j PMTiles, in worker | 166 | 16.7 | 16.7 | 1.00 | 17 | 0 | 11 | 18 | 0 | 4.8 + 3.4 | 93 + 60 |
| world | A deck.gl | 3259 | 16.7 | 16.7 | 1.00 | 17 | 0 | 0 | 0 | 0 | 163.7 + 1.1 | 2533 + 0 |
| world | B h3j, main thread | 2409 | 31.2 | 150.0 | 8.98 | 450 | 149 | 21 | 188 | 2742 | 36.8 + 22.2 | 2533 + 0 |
| world | C h3j PMTiles, main thread | 2097 | 31.0 | 149.9 | 8.98 | 433 | 147 | 23 | 188 | 2675 | 6.4 + 22.2 | 2776 + 4510 |
| world | B-w h3j, in worker | 3244 | 16.7 | 16.8 | 1.01 | 17 | 0 | 179 | 715 | 0 | 4.5 + 54.4 | 2533 + 0 |
| world | C-w h3j PMTiles, in worker | 2884 | 16.7 | 16.8 | 1.01 | 17 | 0 | 183 | 944 | 0 | 4.6 + 23.5 | 2775 + 4510 |
| world | B-w, 3 workers | 1658 | 16.7 | 16.7 | 1.00 | 17 | 0 | 115 | 17 | 0 | 4.6 + 122.5 | 7598 + 0 |
| world | C-w, 3 workers | 1379 | 16.7 | 16.7 | 1.00 | 17 | 0 | 118 | 35 | 0 | 4.6 + 29.7 | 2808 + 4510 |

### uncapped, es (101,859 cells)

| view | variant | first draw ms | mean ms | p95 ms | p95 / A | max ms | dropped | frames with tiles missing | settle ms | long tasks ms | heap MB main + workers | data KB load + motion |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fiji | A deck.gl | 644 | 1.6 | 3.6 | 1.00 | 22 | 0 | 0 | 0 | 0 | 30.4 + 1.1 | 478 + 0 |
| fiji | B h3j, main thread | 154 | 1.2 | 3.0 | 0.83 | 25 | 0 | 20 | 0 | 0 | 10.7 + 1.8 | 478 + 0 |
| fiji | C h3j PMTiles, main thread | 113 | 1.2 | 3.0 | 0.83 | 25 | 0 | 49 | 0 | 0 | 6.5 + 1.8 | 32 + 15 |
| fiji | B-w h3j, in worker | 170 | 1.2 | 3.0 | 0.83 | 23 | 0 | 27 | 3 | 0 | 4.6 + 7.9 | 478 + 0 |
| fiji | C-w h3j PMTiles, in worker | 107 | 1.2 | 3.0 | 0.83 | 22 | 0 | 27 | 3 | 0 | 4.8 + 3 | 32 + 15 |
| world | A deck.gl | 654 | 1.4 | 3.5 | 1.00 | 22 | 0 | 0 | 0 | 0 | 30.2 + 1.1 | 478 + 0 |
| world | B h3j, main thread | 505 | 1.3 | 3.1 | 0.89 | 129 | 15 | 167 | 3 | 205 | 10.8 + 5.2 | 478 + 0 |
| world | C h3j PMTiles, main thread | 466 | 1.3 | 3.1 | 0.89 | 105 | 12 | 178 | 3 | 208 | 6.3 + 5.2 | 556 + 866 |
| world | B-w h3j, in worker | 640 | 1.3 | 3.1 | 0.89 | 25 | 0 | 417 | 0 | 0 | 4.5 + 11.3 | 478 + 0 |
| world | C-w h3j PMTiles, in worker | 568 | 1.3 | 3.1 | 0.89 | 22 | 0 | 417 | 0 | 0 | 4.6 + 6.3 | 556 + 866 |

### uncapped, n (676,874 cells)

| view | variant | first draw ms | mean ms | p95 ms | p95 / A | max ms | dropped | frames with tiles missing | settle ms | long tasks ms | heap MB main + workers | data KB load + motion |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fiji | A deck.gl | 3434 | 1.9 | 4.8 | 1.00 | 23 | 0 | 0 | 0 | 0 | 163.9 + 1.1 | 2533 + 0 |
| fiji | B h3j, main thread | 490 | 1.2 | 3.0 | 0.63 | 19 | 0 | 31 | 2 | 0 | 36.9 + 2.2 | 2533 + 0 |
| fiji | C h3j PMTiles, main thread | 149 | 1.2 | 3.0 | 0.63 | 25 | 0 | 56 | 0 | 0 | 6.6 + 2.2 | 94 + 60 |
| fiji | B-w h3j, in worker | 531 | 1.2 | 3.0 | 0.63 | 23 | 0 | 54 | 2 | 0 | 4.7 + 34.2 | 2533 + 0 |
| fiji | C-w h3j PMTiles, in worker | 173 | 1.2 | 3.0 | 0.63 | 22 | 0 | 54 | 0 | 0 | 4.9 + 3.4 | 93 + 60 |
| world | A deck.gl | 3414 | 1.9 | 5.6 | 1.00 | 24 | 0 | 0 | 0 | 0 | 163.7 + 1.1 | 2533 + 0 |
| world | B h3j, main thread | 2529 | 2.2 | 3.2 | 0.57 | 507 | 113 | 262 | 197 | 2867 | 36.8 + 22.2 | 2533 + 0 |
| world | C h3j PMTiles, main thread | 2247 | 2.2 | 3.2 | 0.57 | 478 | 113 | 265 | 199 | 2802 | 6.5 + 22.2 | 2776 + 4510 |
| world | B-w h3j, in worker | 3339 | 1.5 | 3.2 | 0.57 | 478 | 50 | 1856 | 767 | 1209 | 4.5 + 54.3 | 2533 + 0 |
| world | C-w h3j PMTiles, in worker | 2964 | 1.5 | 3.2 | 0.57 | 461 | 46 | 1886 | 1050 | 1171 | 4.6 + 23.5 | 2775 + 4510 |
