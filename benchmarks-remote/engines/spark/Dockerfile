FROM python:3.11-bookworm

ARG SPARK_VERSION=4.2.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl openjdk-17-jre-headless \
    && pip install --no-cache-dir flask==3.0.0 pyspark==${SPARK_VERSION} \
    && spark_home=$(python -c 'import os,pyspark; print(os.path.dirname(pyspark.__file__))') \
    && curl -fsSL -o "${spark_home}/jars/hadoop-aws-3.5.0.jar" https://repo1.maven.org/maven2/org/apache/hadoop/hadoop-aws/3.5.0/hadoop-aws-3.5.0.jar \
    && curl -fsSL -o "${spark_home}/jars/bundle-2.35.4.jar" https://repo1.maven.org/maven2/software/amazon/awssdk/bundle/2.35.4/bundle-2.35.4.jar \
    && curl -fsSL -o "${spark_home}/jars/analyticsaccelerator-s3-1.3.1.jar" https://repo1.maven.org/maven2/software/amazon/s3/analyticsaccelerator/analyticsaccelerator-s3/1.3.1/analyticsaccelerator-s3-1.3.1.jar \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV SPARK_HOME=/usr/local/lib/python3.11/site-packages/pyspark
ENV PATH=${SPARK_HOME}/bin:${SPARK_HOME}/sbin:${PATH}
COPY spark_http.py /opt/benchmark/spark_http.py
