import setuptools

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setuptools.setup(
    name="code_instruments",
    version="0.0.1",
    author="Alan Pita",
    author_email="pitaman512@gmail.com",
    description="Task logging library for measuring and optimizing system-level performance across software components.",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/pitaman71/code-instruments",
    project_urls={
        "Bug Tracker": "https://github.com/pitaman71/code-instruments/issues",
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    package_dir={"": "."},
    packages=setuptools.find_packages(where="."),
    python_requires=">=3.6",
)
