"""Valid controlled knowledge output for durable tests, without model/network calls."""


def knowledge_result(title="Water cycle", description="Water moves between land, air and oceans.", **extra):
    return {
        "title": title, "description": description, "layout": "atlas",
        "sections": [{"title": "Evaporation", "body": "Energy from sunlight lets liquid water become vapor and enter the atmosphere."}],
        "subject_en": "Water cycle", "sub_topics_en": ["water vapor"], "composition_type": "diagram",
        **extra,
    }
