#!/usr/bin/env Rscript
# build the iea-sd cross-check fixture by running the REAL ecoidx PlotTimeSeries() ----
#
# usage: Rscript fixtures/ecoidx/build_iea_sd_fixtures.R [path to ecoidx checkout]
#        (default ~/Github/noaa-iea/ecoidx)
#
# writes fixtures/ecoidx/iea_sd_cciea.json next to this script. nothing here re-implements the status
# method: the glyphs are what PlotTimeSeries() draws (its text() and points() calls, recorded on a null
# pdf device) and mn, stdev, mn5, delta, Z, Z2 are read from the function's own frame on exit (trace).
# the function body is not edited. the only independent arithmetic is the consistency check at the end
# (reported to the console, never written to the fixture).

librarian::shelf(jsonlite, dplyr, quiet = TRUE)

# paths ----
args       <- commandArgs(trailingOnly = TRUE)
dir_ecoidx <- normalizePath(path.expand(if (length(args) >= 1) args[1] else "~/Github/noaa-iea/ecoidx"), mustWork = TRUE)
f_arg      <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))
dir_out    <- if (length(f_arg)) dirname(normalizePath(f_arg[1])) else normalizePath("fixtures/ecoidx")
f_out      <- file.path(dir_out, "iea_sd_cciea.json")
f_pts      <- file.path(dir_ecoidx, "R", "PlotTimeSeries.R")
stopifnot(file.exists(f_pts), dir.exists(file.path(dir_ecoidx, "data")))

Sys.setenv(TZ = "UTC")   # PlotTimeSeries builds POSIXct x from the year; fix the zone for determinism
options(warn = 1)
set.seed(20261020)

ecoidx_commit <- system2("git", c("-C", shQuote(dir_ecoidx), "rev-parse", "HEAD"), stdout = TRUE)
stopifnot(length(ecoidx_commit) == 1, nzchar(ecoidx_commit))

# the real function, with recording wrappers for text() and points() in its enclosure ----
pts_src <- new.env()
sys.source(f_pts, pts_src)
stopifnot(is.function(pts_src$PlotTimeSeries))

REC <- new.env()
REC$reset <- function() {
  REC$text   <- list()
  REC$points <- list()
  REC$locals <- NULL
  REC$warn   <- character()
}
REC$reset()

wrap <- new.env(parent = globalenv())
wrap$text <- function(x, y = NULL, labels = seq_along(x), ...) {
  dots <- list(...)
  rec  <- REC   # a complex assignment needs a local binding of the environment
  rec$text[[length(rec$text) + 1L]] <- list(
    labels = as.character(labels)[1],
    chr    = is.character(labels),
    family = if (is.null(dots$family)) NA_character_ else dots$family)
  graphics::text(x, y, labels = labels, ...)
}
wrap$points <- function(x, y = NULL, ...) {
  dots <- list(...)
  rec  <- REC
  rec$points[[length(rec$points) + 1L]] <- list(
    pch    = if (is.null(dots$pch)) NA_real_ else as.numeric(dots$pch),
    scalar = is.numeric(x) && length(x) == 1L)
  if (inherits(x, "formula")) {
    pf <- parent.frame()   # points.formula() evaluates the formula variables in the caller's frame
    do.call(graphics::points, c(list(x, data = pf), dots))   # points.formula() uses match.call(), so no `...` forwarding
  } else {
    graphics::points(x, y, ...)
  }
}
pts_fun <- pts_src$PlotTimeSeries
environment(pts_fun) <- wrap
assign("PTS", pts_fun, envir = wrap)
invisible(suppressMessages(trace(
  "PTS", where = wrap, print = FALSE,
  exit = quote(assign("locals", mget(c("mn", "stdev", "mn5", "delta", "Z", "Z2"), envir = environment(), ifnotfound = list(NA_real_)), envir = REC)))))

pdf(NULL)

GLYPH_TREND  <- c(flat = "\\->", up = "\\#H2296", down = "\\#H2299")
GLYPH_STATUS <- c(within = "pch19", below = "_", above = "+")

# run PlotTimeSeries() on one series and report what it drew ----
# x: integer years (rows in order, NA rows included); y: numeric with NA; native: a data frame in
# PlotTimeSeries format (year, index, ...) to use the dframe path instead of X/Y.
run_pts <- function(x, y, period = 5L, stats_years = NULL, native = NULL) {
  REC$reset()
  sy <- if (is.null(stats_years)) NA else seq(stats_years[1], stats_years[2])
  call_args <- if (is.null(native)) {
    list(dframe = NA, X = sprintf("%04d", as.integer(x)), Y = y, Y2 = y, Title = NA, Ylab = "y",
         PERIOD = period, stats.years = sy)
  } else {
    list(dframe = native, Y2 = NA, Title = NA, Ylab = NA, PERIOD = period, stats.years = sy)
  }
  err <- tryCatch({
    withCallingHandlers(
      do.call(wrap$PTS, call_args),
      warning = function(w) { REC$warn <- c(REC$warn, conditionMessage(w)); invokeRestart("muffleWarning") })
    NULL
  }, error = function(e) conditionMessage(e))

  if (!is.null(err)) return(list(expected = NULL, error = err, warn = REC$warn))

  tr     <- Filter(function(t) identical(t$family, "HersheySymbol"), REC$text)
  st_txt <- Filter(function(t) t$chr && t$labels %in% c("_", "+"), REC$text)
  st_pt  <- Filter(function(p) isTRUE(p$pch == 19) && p$scalar, REC$points)
  if (length(tr) != 1L || length(st_txt) + length(st_pt) != 1L)
    stop(sprintf("capture ambiguous: %d trend glyphs, %d status glyphs", length(tr), length(st_txt) + length(st_pt)))

  glyph_trend  <- tr[[1]]$labels
  glyph_status <- if (length(st_pt) == 1L) "pch19" else st_txt[[1]]$labels
  l <- lapply(REC$locals, function(v) unname(as.numeric(v)))
  list(
    expected = list(
      status = names(GLYPH_STATUS)[match(glyph_status, GLYPH_STATUS)],
      trend  = names(GLYPH_TREND)[match(glyph_trend, GLYPH_TREND)],
      glyph_status = glyph_status, glyph_trend = glyph_trend,
      mn = l$mn, sd = l$stdev, mn5 = l$mn5, delta = l$delta, Z = l$Z, Z2 = l$Z2),
    error = NULL, warn = REC$warn)
}

series_list <- list()
add_series <- function(id, kind, x, y, period = 5L, stats_years = NULL, native = NULL, note = NULL) {
  r <- run_pts(x, y, period, stats_years, native)
  series_list[[length(series_list) + 1L]] <<- list(
    id = id, kind = kind, period = as.integer(period), stats_years = stats_years, note = note,
    x = as.integer(x), y = y, expected = r$expected, error = r$error, warn = r$warn)
  invisible(r)
}

# (a) cciea_* datasets: annual means by calendar year ----
dir_data <- file.path(dir_ecoidx, "data")
f_cciea  <- sort(list.files(dir_data, "^cciea_.*[.]rda$"), method = "radix")
skipped  <- list()
annual_defs <- list()   # id, x, y: reused for the baseline and PERIOD = 10 runs

for (f in f_cciea) {
  e   <- new.env()
  nm  <- load(file.path(dir_data, f), e)[1]
  d   <- get(nm, e)
  if (!all(c("time", "variable", "value_numeric") %in% names(d)) || !inherits(d$time, "POSIXct")) {
    skipped[[length(skipped) + 1L]] <- list(dataset = nm, why = sprintf(
      "not the time/variable/value_numeric shape (columns: %s)", paste(names(d), collapse = ", ")))
    next
  }
  ann <- d |>
    filter(!is.na(value_numeric)) |>
    mutate(year = as.integer(format(time, "%Y", tz = "UTC"))) |>
    group_by(variable, year) |>
    summarise(v = mean(value_numeric), .groups = "drop")
  for (v in sort(unique(d$variable), method = "radix")) {
    a <- ann[ann$variable == v, ]
    if (nrow(a) < 5L + 2L) {
      skipped[[length(skipped) + 1L]] <- list(dataset = nm, variable = v, why = sprintf(
        "fewer than %d years with a numeric value (%d)", 5L + 2L, nrow(a)))
      next
    }
    yrs <- seq(min(a$year), max(a$year))
    y   <- a$v[match(yrs, a$year)]   # NA rows kept for missing years inside the range
    id  <- sprintf("%s:%s:annual", nm, v)
    add_series(id, "cciea-annual", yrs, y)
    annual_defs[[length(annual_defs) + 1L]] <- list(id = id, x = yrs, y = y)
  }
}

# (b) native PlotTimeSeries-format datasets, unaggregated ----
native_defs <- list()
for (nm in c("groundfish", "ts1")) {
  e <- new.env()
  load(file.path(dir_data, paste0(nm, ".rda")), e)
  d <- as.data.frame(get(nm, e))
  for (ts in sort(unique(d$timeseries), method = "radix")) {
    s <- d[d$timeseries == ts, , drop = FALSE]
    s <- s[order(s$year), , drop = FALSE]
    if (sum(!is.na(s$index)) < 5L + 2L) {
      skipped[[length(skipped) + 1L]] <- list(dataset = nm, variable = ts, why = "fewer than 7 non-NA rows")
      next
    }
    id <- sprintf("%s:%s", nm, ts)
    add_series(id, "native", s$year, s$index, native = s)
    native_defs[[length(native_defs) + 1L]] <- list(id = id, x = s$year, y = s$index, native = s)
  }
}

# (c) baseline runs: stats.years given ----
# annual series spanning 1991:2020 with at least 20 numeric years inside it, taken evenly (about 16)
covers <- Filter(function(s) {
  min(s$x) <= 1991 && max(s$x) >= 2020 && sum(!is.na(s$y[s$x >= 1991 & s$x <= 2020])) >= 20
}, annual_defs)
pick <- function(l, n) if (length(l) <= n) l else l[unique(round(seq(1, length(l), length.out = n)))]
for (s in pick(covers, 16)) add_series(paste0(s$id, ":baseline-1991-2020"), "baseline", s$x, s$y, stats_years = c(1991L, 2020L))
# a baseline that does not cover the series start or end, and one that is short
for (s in pick(Filter(function(s) min(s$x) <= 1980 && max(s$x) >= 2015, annual_defs), 3))
  add_series(paste0(s$id, ":baseline-1981-2010"), "baseline", s$x, s$y, stats_years = c(1981L, 2010L))
for (s in Filter(function(s) grepl("^groundfish:Spp (Richness|Density) (Coastwide|North)$", s$id), native_defs))
  add_series(paste0(s$id, ":baseline-2003-2012"), "baseline", s$x, s$y, stats_years = c(2003L, 2012L), native = s$native)
for (s in native_defs[grepl("^ts1:", vapply(native_defs, `[[`, "", "id"))])
  add_series(paste0(s$id, ":baseline-1991-2010"), "baseline", s$x, s$y, stats_years = c(1991L, 2010L), native = s$native)

# PERIOD = 10 on a handful of annual series (need at least 12 numeric years) and on one baseline
long10 <- Filter(function(s) sum(!is.na(s$y)) >= 12, annual_defs)
for (s in pick(long10, 10)) add_series(paste0(s$id, ":period10"), "cciea-annual", s$x, s$y, period = 10L)
for (s in pick(covers, 2)) add_series(paste0(s$id, ":period10:baseline-1991-2020"), "baseline", s$x, s$y, period = 10L, stats_years = c(1991L, 2020L))

# glyph combination tally of what the real function drew ----
combo_counts <- function() {
  ok <- Filter(function(s) !is.null(s$expected), series_list)
  tab <- table(
    status = factor(vapply(ok, function(s) s$expected$status, ""), c("above", "within", "below")),
    trend  = factor(vapply(ok, function(s) s$expected$trend, ""),  c("up", "flat", "down")))
  tab
}

# (d) synthetic edge cases, each run through the same real function ----
yrs20 <- 2001:2020
secs  <- function(yr) as.numeric(as.POSIXct(paste(yr, 1, 1, sep = "-"), tz = "UTC"))

# fast sign-rule check, used ONLY to search for synthetic series with a wanted combination;
# the fixture records what the real function drew
quick_combo <- function(y, yr, period = 5L) {
  n <- length(y); i <- (n - period + 1L):n
  y5 <- y[i]; t5 <- secs(yr[i])
  ok <- !is.na(y5)
  fit <- lm(y5[ok] ~ t5[ok]); pr <- predict(fit)
  delta <- pr[length(pr)] - pr[1]; sdv <- sd(y, na.rm = TRUE)
  dmean <- mean(y, na.rm = TRUE) - mean(y5, na.rm = TRUE)
  c(status = if (abs(dmean) - sdv <= 0) "within" else if (dmean > 0) "below" else "above",
    trend  = if (abs(delta) - sdv <= 0) "flat" else if (delta > 0) "up" else "down")
}

# one series per glyph combination missing from (a)-(c)
tab <- combo_counts()
for (st in rownames(tab)) for (tr in colnames(tab)) {
  if (tab[st, tr] > 0) next
  found <- NULL
  for (k in 1:20000) {
    y <- c(round(rnorm(15), 3), round(runif(1, -3, 3) + runif(1, -1.5, 1.5) * (0:4) + rnorm(5, 0, 0.1), 3))
    cb <- quick_combo(y, yrs20)
    if (cb["status"] == st && cb["trend"] == tr) { found <- y; break }
  }
  stopifnot(!is.null(found))
  r <- add_series(sprintf("synthetic:combo-%s-%s", st, tr), "synthetic", yrs20, found,
                  note = sprintf("searched series for the %s/%s glyph combination", st, tr))
  if (!identical(c(r$expected$status, r$expected$trend), unname(c(st, tr)))) {
    str(r); stop("synthetic combo mismatch for ", st, "/", tr)
  }
}

# a trend change of almost exactly k sd (k = 0.999, 1.001) on each side: last 5 values on a straight
# line in time, slope solved so that |delta| / sd(full series) = k; first 15 fixed
first15 <- c(0.3, -1.1, 0.8, 1.5, -0.4, -0.9, 0.2, 1.2, -1.3, 0.6, 0.1, -0.7, 1.0, -0.2, 0.5)
tdays   <- (secs(yrs20) - secs(yrs20[16])) / 86400
for (k in c(0.999, 1.001)) for (dir in c(1, -1)) {
  mk <- function(b) c(first15, round(dir * b * tdays[16:20], 8))
  ratio <- function(b) { y <- mk(b); abs(dir * b * (tdays[20] - tdays[16])) / sd(y) }   # |delta| / sd
  b <- uniroot(function(b) ratio(b) - k, c(1e-6, 10), tol = 1e-14)$root
  y <- mk(b)
  r <- add_series(sprintf("synthetic:trend-%s-sd-%s", format(k), if (dir > 0) "up" else "down"), "synthetic",
                  yrs20, y, note = sprintf("|delta| = %s sd by construction (last 5 on a line in time)", format(k)))
  stopifnot(abs(abs(r$expected$delta) / r$expected$sd - k) < 1e-6)
}

# a status difference of almost exactly k sd on each side: last 5 values constant c, solved so that
# |mean(full) - c| / sd(full) = k
for (k in c(0.999, 1.001)) for (dir in c(1, -1)) {   # dir = 1: recent mean above the long-term mean
  mk <- function(cc) c(first15, rep(round(cc, 8), 5))
  m15 <- mean(first15)
  g <- function(cc) { y <- mk(cc); abs(mean(y) - round(cc, 8)) / sd(y) - k }
  cc <- if (dir > 0) uniroot(g, c(m15, m15 + 100), tol = 1e-14)$root else uniroot(g, c(m15 - 100, m15), tol = 1e-14)$root
  y <- mk(cc)
  r <- add_series(sprintf("synthetic:status-%s-sd-%s", format(k), if (dir > 0) "above" else "below"), "synthetic",
                  yrs20, y, note = sprintf("|mn - mn5| = %s sd by construction (last 5 constant)", format(k)))
  stopifnot(abs(abs(r$expected$mn - r$expected$mn5) / r$expected$sd - k) < 1e-6)
}

# NA handling in the recent window and at the end
base20 <- c(round(rnorm(15), 3), round(c(0.2, 1.1, 1.4, 2.6, 3.1), 3))
na_in  <- base20; na_in[18] <- NA
na_first <- base20; na_first[16] <- NA
na_last <- base20; na_last[20] <- NA
na_two <- base20; na_two[c(17, 19)] <- NA
na_mid <- base20; na_mid[c(4, 5, 9)] <- NA
add_series("synthetic:na-in-window", "synthetic", yrs20, na_in, note = "NA inside the recent window; lm drops it, delta uses the first and last non-NA fitted values")
add_series("synthetic:na-first-of-window", "synthetic", yrs20, na_first, note = "NA at the first row of the recent window")
add_series("synthetic:na-last-row", "synthetic", yrs20, na_last, note = "NA as the last row; the window still ends on it")
add_series("synthetic:na-two-in-window", "synthetic", yrs20, na_two, note = "two NA rows inside the recent window")
add_series("synthetic:na-outside-window", "synthetic", yrs20, na_mid, note = "NA rows before the recent window")
add_series("synthetic:na-last-row-period10", "synthetic", yrs20, na_last, period = 10L, note = "NA as the last row, PERIOD = 10")
add_series("synthetic:na-in-window-period10", "synthetic", yrs20, na_in, period = 10L, note = "NA inside the window, PERIOD = 10")
add_series("synthetic:one-value-in-window", "synthetic", yrs20, c(base20[1:15], NA, NA, NA, NA, 3.2),
           note = "one non-NA value in the recent window: lm has no slope; expected to error in PlotTimeSeries")
add_series("synthetic:all-na-window", "synthetic", yrs20, c(base20[1:15], rep(NA_real_, 5)),
           note = "recent window entirely NA; expected to error in PlotTimeSeries")

# constant series (sd = 0): record what the function does
add_series("synthetic:constant", "synthetic", yrs20, rep(5, 20), note = "constant series, sd = 0: Z = 0 and Z2 = 0, so flat and within")
add_series("synthetic:constant-with-noise-level", "synthetic", yrs20, rep(0.1, 20), note = "constant series 0.1, sd = 0; lm's floating-point noise (|delta| ~ 1e-17 > sd = 0) flips the trend glyph to down: a numerical artefact, not a rule a port must reproduce")
add_series("synthetic:constant-then-step", "synthetic", yrs20, c(rep(2, 19), 2.0000001), note = "constant except a last-row step of 1e-7; sd is tiny but not 0")

# exactly PERIOD rows
add_series("synthetic:exactly-period-rows", "synthetic", 2016:2020, c(1, 3, 2, 5, 4), note = "exactly PERIOD = 5 rows: the window is the whole series")
add_series("synthetic:exactly-period-rows-trend", "synthetic", 2016:2020, c(1, 2, 3, 4, 5.5), note = "exactly PERIOD = 5 rows, monotone")
add_series("synthetic:exactly-period10-rows", "synthetic", 2011:2020, c(1, 3, 2, 5, 4, 6, 5, 8, 7, 9), period = 10L, note = "exactly PERIOD = 10 rows")
add_series("synthetic:fewer-than-period-rows", "synthetic", 2013:2020, c(1, 3, 2, 5, 4, 6, 5, 8), period = 10L, note = "8 rows with PERIOD = 10: yloc < 1, expected to error")
add_series("synthetic:period-plus-one-rows", "synthetic", 2015:2020, c(1, 3, 2, 5, 4, 7), note = "PERIOD + 1 rows")

# more PERIOD = 10 combinations
for (k in 1:6) {
  y <- c(round(rnorm(20), 3)) + c(rep(0, 10), rep(c(0, 0.6, 1.2, 1.8, 2.4, 3)[k], 10)) + (1:20) * c(0, 0.05, -0.05, 0.12, -0.12, 0)[k]
  add_series(sprintf("synthetic:period10-random-%d", k), "synthetic", yrs20, round(y, 4), period = 10L, note = "random series, PERIOD = 10")
}

# consistency checks (console only) ----
n_off <- 0L; n_err_inconsistent <- 0L
for (s in series_list) {
  if (is.null(s$expected)) next
  ex <- s$expected
  z2  <- abs(ex$mn - ex$mn5) - ex$sd
  stt <- if (z2 <= 0) "within" else if (ex$mn - ex$mn5 > 0) "below" else "above"
  z   <- abs(ex$delta) - ex$sd
  trd <- if (z <= 0) "flat" else if (ex$delta > 0) "up" else "down"
  if (stt != ex$status || trd != ex$trend) {
    n_off <- n_off + 1L
    cat("SIGN-RULE DISAGREEMENT:", s$id, "drawn", ex$status, ex$trend, "rules", stt, trd, "\n")
  }
  if (abs(z - ex$Z) > 1e-12 || abs(z2 - ex$Z2) > 1e-12)
    cat("Z/Z2 differ from abs(.) - sd:", s$id, "\n")
  # independent recomputation of the numbers from the series
  yy <- s$y; xx <- s$x; n <- length(yy); i <- (n - s$period + 1L):n
  if (i[1] >= 1L) {
    inbase <- if (is.null(s$stats_years)) rep(TRUE, n) else xx >= s$stats_years[1] & xx <= s$stats_years[2]
    mn <- mean(yy[inbase], na.rm = TRUE); sdv <- sd(yy[inbase], na.rm = TRUE)
    mn5 <- mean(yy[i], na.rm = TRUE)
    ok <- !is.na(yy[i]); pr <- predict(lm(yy[i][ok] ~ secs(xx[i])[ok]))
    delta <- unname(pr[length(pr)] - pr[1])
    tol <- function(a, b) abs(a - b) <= 1e-9 * max(1, abs(a), abs(b))
    if (!(tol(mn, ex$mn) && tol(sdv, ex$sd) && tol(mn5, ex$mn5) && tol(delta, ex$delta)))
      cat("RECOMPUTE MISMATCH:", s$id, "\n")
    # trend with the year index as x instead of the time: how often the glyph would differ
    pr2 <- predict(lm(yy[i][ok] ~ xx[i][ok])); d2 <- unname(pr2[length(pr2)] - pr2[1])
    t2 <- if (abs(d2) - ex$sd <= 0) "flat" else if (d2 > 0) "up" else "down"
    if (t2 != ex$trend) cat("year-index x would change the trend glyph:", s$id, ex$trend, "->", t2, "\n")
  }
}

# write the JSON (hand-serialised so numbers keep full double precision) ----
# shortest of %.15g, %.16g that R reads back to the same double, else %.17g (which any correct parser,
# such as JavaScript's, reads back exactly; R's own as.numeric() is not correctly rounded at 17 digits)
num1 <- function(v) {
  if (is.na(v)) return("null")
  target <- sprintf("%.17g", v)
  for (d in 15:16) { s <- sprintf(paste0("%.", d, "g"), v); if (sprintf("%.17g", as.numeric(s)) == target) return(s) }
  target
}
nums <- function(v) paste0("[", paste(vapply(v, num1, ""), collapse = ", "), "]")
str1 <- function(s) as.character(toJSON(s, auto_unbox = TRUE))

series_json <- function(s) {
  ex <- if (is.null(s$expected)) "null" else {
    e <- s$expected
    sprintf('{"status": %s, "trend": %s, "glyph_status": %s, "glyph_trend": %s, "mn": %s, "sd": %s, "mn5": %s, "delta": %s, "Z": %s, "Z2": %s}',
            str1(e$status), str1(e$trend), str1(e$glyph_status), str1(e$glyph_trend),
            num1(e$mn), num1(e$sd), num1(e$mn5), num1(e$delta), num1(e$Z), num1(e$Z2))
  }
  sprintf('{"id": %s, "kind": %s, "period": %d, "stats_years": %s, %s"x": %s, "y": %s, "expected": %s, "error": %s}',
          str1(s$id), str1(s$kind), s$period,
          if (is.null(s$stats_years)) "null" else paste0("[", paste(s$stats_years, collapse = ", "), "]"),
          if (is.null(s$note)) "" else sprintf('"note": %s, ', str1(s$note)),
          paste0("[", paste(s$x, collapse = ", "), "]"), nums(s$y), ex,
          if (is.null(s$error)) "null" else str1(s$error))
}
skipped_json <- vapply(skipped, function(s) {
  as.character(toJSON(s, auto_unbox = TRUE))
}, "")

created <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
lines <- c(
  "{",
  sprintf('"source": %s,', str1("ecoidx PlotTimeSeries() run by fixtures/ecoidx/build_iea_sd_fixtures.R")),
  sprintf('"ecoidx_commit": %s,', str1(ecoidx_commit)),
  sprintf('"created": %s,', str1(created)),
  sprintf('"r_version": %s,', str1(R.version.string)),
  if (length(skipped_json)) c('"skipped": [', paste0(skipped_json, c(rep(",", length(skipped_json) - 1L), "")), '],') else '"skipped": [],',
  '"series": [',
  paste0(vapply(series_list, series_json, ""), c(rep(",", length(series_list) - 1L), "")),
  "]",
  "}")
writeLines(lines, f_out)

# validate that it parses, and summarise ----
chk <- fromJSON(f_out, simplifyVector = FALSE)
stopifnot(length(chk$series) == length(series_list))
cat("\nwrote", f_out, sprintf("(%.0f KB)\n", file.size(f_out) / 1024))
cat("series by kind:\n"); print(table(vapply(series_list, `[[`, "", "kind")))
cat("status x trend of the real function's drawing:\n"); print(combo_counts())
errs <- Filter(function(s) !is.null(s$error), series_list)
cat("errored series:", length(errs), "\n")
for (s in errs) cat("  ", s$id, "->", s$error, "\n")
cat("sign-rule disagreements:", n_off, "\n")
