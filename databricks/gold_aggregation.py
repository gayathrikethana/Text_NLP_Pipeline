# Databricks notebook source
# gold_aggregation.py
# Reads the silver layer, creates the three gold datasets,
# and replaces the run-date partition on each execution.

# COMMAND ----------

# ADF parameters
dbutils.widgets.text("run_date", "", "Run date (YYYY-MM-DD)")
dbutils.widgets.text(
    "silver_root",
    "abfss://articles-silver@<account>.dfs.core.windows.net",
    "Silver ADLS path",
)
dbutils.widgets.text(
    "gold_root",
    "abfss://articles-gold@<account>.dfs.core.windows.net",
    "Gold ADLS path",
)
dbutils.widgets.text("lookback_days", "7", "Silver lookback days")
dbutils.widgets.text("keyword_window", "3", "Keyword trend window")
dbutils.widgets.text(
    "categories",
    "technology,business,science,health",
    "News categories",
)

# COMMAND ----------

from datetime import date, timedelta, datetime

from pyspark.sql import functions as F
from pyspark.sql.window import Window
from pyspark.sql.types import StringType, DoubleType

try:
    from utils.delta_helpers import (
        overwrite_partition,
        assert_silver_schema,
        log_data_quality,
    )
except ImportError:
    import sys
    import os

    sys.path.insert(
        0,
        os.path.join(os.path.dirname(__file__), "utils"),
    )

    from delta_helpers import (
        overwrite_partition,
        assert_silver_schema,
        log_data_quality,
    )


# Read parameters
date_input = dbutils.widgets.get("run_date").strip()
silver_path = dbutils.widgets.get("silver_root").rstrip("/")
gold_path = dbutils.widgets.get("gold_root").rstrip("/")

lookback = int(dbutils.widgets.get("lookback_days") or 7)
phrase_days = int(dbutils.widgets.get("keyword_window") or 3)

category_text = (
    dbutils.widgets.get("categories")
    or "technology,business,science,health"
)

category_list = [
    value.strip()
    for value in category_text.split(",")
    if value.strip()
]

# Use yesterday when ADF does not provide a date.
date_input = date_input or (
    date.today() - timedelta(days=1)
).isoformat()

run_day = datetime.strptime(
    date_input,
    "%Y-%m-%d",
).date()

print(f"Run date       : {date_input}")
print(f"Silver path    : {silver_path}")
print(f"Gold path      : {gold_path}")
print(f"Lookback       : {lookback}")
print(f"Keyword window : {phrase_days}")


# COMMAND ----------

# Load only the silver partitions needed for this run.
first_day = run_day - timedelta(days=lookback - 1)

days = [
    (first_day + timedelta(days=n)).isoformat()
    for n in range(lookback)
]

print(f"Loading {days[0]} -> {days[-1]}")

frames = []

for category in category_list:
    for day in days:
        source = f"{silver_path}/{category}/{day}/"

        try:
            part = (
                spark.read.json(source)
                .withColumn("_category", F.lit(category))
                .withColumn("_date", F.lit(day))
            )
            frames.append(part)

        except Exception as err:
            print(
                f"Skipping {category}/{day}: "
                f"{str(err)[:80]}"
            )

if not frames:
    print("No silver records found.")
    dbutils.notebook.exit("NO_DATA")

silver = frames[0]

for frame in frames[1:]:
    silver = silver.unionByName(
        frame,
        allowMissingColumns=True,
    )


# Select the fields required by the gold layer.
silver = (
    silver.select(
        "id",
        F.col("category"),
        F.col("_date").alias("article_date"),
        F.col("publishedAt").alias("published_at"),
        F.col("sentiment.label").alias("sentiment_label"),
        F.col("sentiment.scores.positive")
            .cast(DoubleType())
            .alias("sentiment_positive"),
        F.col("sentiment.scores.negative")
            .cast(DoubleType())
            .alias("sentiment_negative"),
        F.col("sentiment.scores.neutral")
            .cast(DoubleType())
            .alias("sentiment_neutral"),
        "entities",
        "keyPhrases",
        "nlpStatus",
    )
    .filter(F.col("nlpStatus") == "ok")
)

assert_silver_schema(silver)

article_total = silver.count()

print(f"Valid NLP articles: {article_total}")

log_data_quality(
    silver,
    "silver-window",
)


# COMMAND ----------

# GOLD 1: Daily sentiment trends
#
# Calculates sentiment statistics for each category and article date.

sentiment_gold = (
    silver
    .groupBy("category", "article_date")
    .agg(
        F.count("id").alias("article_count"),
        F.round(F.avg("sentiment_positive"), 4)
            .alias("avg_positive"),
        F.round(F.avg("sentiment_negative"), 4)
            .alias("avg_negative"),
        F.round(F.avg("sentiment_neutral"), 4)
            .alias("avg_neutral"),
    )
    .withColumn(
        "dominant_sentiment",
        F.when(
            F.col("avg_positive") >= F.col("avg_negative"),
            "positive",
        )
        .when(
            F.col("avg_negative") > F.col("avg_neutral"),
            "negative",
        )
        .otherwise("neutral"),
    )
    .withColumn("run_date", F.lit(date_input))
    .orderBy("category", "article_date")
)

sentiment_path = f"{gold_path}/sentiment_trends"

overwrite_partition(
    sentiment_gold,
    sentiment_path,
    "run_date",
    date_input,
)

sentiment_rows = sentiment_gold.count()

print(
    f"Sentiment output: "
    f"{sentiment_path}/{date_input} "
    f"({sentiment_rows} rows)"
)


# COMMAND ----------

# GOLD 2: Top entities
#
# Count entity occurrences and retain the top 20 for each category.

entities = (
    silver
    .filter(F.col("entities").isNotNull())
    .select(
        "id",
        "category",
        F.explode("entities").alias("entity"),
    )
    .withColumn(
        "entity_text",
        F.when(
            F.col("entity.text").isNotNull(),
            F.col("entity.text"),
        ).otherwise(
            F.col("entity").cast(StringType())
        ),
    )
    .filter(
        F.col("entity_text").isNotNull()
        & (F.length("entity_text") > 1)
    )
)

entity_totals = (
    entities
    .groupBy("category", "entity_text")
    .agg(
        F.count("id").alias("entity_count")
    )
)

entity_rank = Window.partitionBy(
    "category"
).orderBy(
    F.desc("entity_count")
)

entity_gold = (
    entity_totals
    .withColumn(
        "rank",
        F.row_number().over(entity_rank),
    )
    .filter(F.col("rank") <= 20)
    .withColumn("run_date", F.lit(date_input))
    .orderBy("category", "rank")
)

entity_path = f"{gold_path}/top_entities"

overwrite_partition(
    entity_gold,
    entity_path,
    "run_date",
    date_input,
)

entity_rows = entity_gold.count()

print(
    f"Entity output: "
    f"{entity_path}/{date_input} "
    f"({entity_rows} rows)"
)


# COMMAND ----------

# GOLD 3: Trending keywords
#
# Compare the current keyword window with the immediately
# preceding window.

current_start = (
    run_day - timedelta(days=phrase_days - 1)
).isoformat()

previous_end = (
    run_day - timedelta(days=phrase_days)
).isoformat()

previous_start = (
    run_day - timedelta(days=phrase_days * 2 - 1)
).isoformat()


phrases = (
    silver
    .filter(F.col("keyPhrases").isNotNull())
    .select(
        "id",
        "category",
        "article_date",
        F.explode("keyPhrases").alias("key_phrase"),
    )
    .filter(
        F.col("key_phrase").isNotNull()
        & (F.length("key_phrase") > 2)
    )
    .withColumn(
        "key_phrase",
        F.lower(F.trim("key_phrase")),
    )
)


# Current period
current = (
    phrases
    .filter(F.col("article_date") >= current_start)
    .groupBy("category", "key_phrase")
    .agg(
        F.count("id").alias("count_current")
    )
)


# Previous period
previous = (
    phrases
    .filter(
        (F.col("article_date") >= previous_start)
        & (F.col("article_date") <= previous_end)
    )
    .groupBy("category", "key_phrase")
    .agg(
        F.count("id").alias("count_prior")
    )
)


trend_data = (
    current
    .join(
        previous,
        ["category", "key_phrase"],
        "left",
    )
    .fillna({"count_prior": 0})
    .withColumn(
        "trend_score",
        F.round(
            F.col("count_current")
            / (F.col("count_prior") + 1),
            4,
        ),
    )
)

trend_rank = Window.partitionBy(
    "category"
).orderBy(
    F.desc("trend_score"),
    F.desc("count_current"),
)

keyword_gold = (
    trend_data
    .withColumn(
        "rank",
        F.row_number().over(trend_rank),
    )
    .filter(F.col("rank") <= 30)
    .withColumn("run_date", F.lit(date_input))
    .orderBy("category", "rank")
)

keyword_path = f"{gold_path}/trending_keywords"

overwrite_partition(
    keyword_gold,
    keyword_path,
    "run_date",
    date_input,
)

keyword_rows = keyword_gold.count()

print(
    f"Keyword output: "
    f"{keyword_path}/{date_input} "
    f"({keyword_rows} rows)"
)


# COMMAND ----------

# Final run summary

result = {
    "run_date": date_input,
    "silver_articles": article_total,
    "sentiment_rows": sentiment_rows,
    "entity_rows": entity_rows,
    "keyword_rows": keyword_rows,
    "outputs": {
        "sentiment_trends": sentiment_path,
        "top_entities": entity_path,
        "trending_keywords": keyword_path,
    },
}

print("\nGold aggregation completed")
for key, value in result.items():
    print(f"{key}: {value}")

dbutils.notebook.exit(str(result))