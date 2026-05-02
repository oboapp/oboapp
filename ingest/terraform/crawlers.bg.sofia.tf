# Crawlers for the bg.sofia locality (Sofia, Bulgaria).
# To add a new crawler: add an entry here AND register it in shared/src/sources.ts.
# Set emergent = true for crawlers that should run every 30 minutes.

locals {
  crawlers_bg_sofia = {
    rayon-oborishte = {
      source      = "rayon-oborishte-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Rayon Oborishte website"
    }
    sofia = {
      source      = "sofia-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Sofia municipality"
    }
    sofiyska-voda = {
      source      = "sofiyska-voda"
      memory      = "512Mi"
      timeout     = "1800s"
      description = "Crawl Sofiyska Voda"
      emergent    = true
    }
    toplo = {
      source      = "toplo-bg"
      memory      = "512Mi"
      timeout     = "1800s"
      description = "Crawl Toplo BG"
      emergent    = true
    }
    erm-zapad = {
      source      = "erm-zapad"
      memory      = "512Mi"
      timeout     = "1800s"
      description = "Crawl ERM-Zapad power outages"
      emergent    = true
    }
    mladost = {
      source      = "mladost-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Mladost district"
    }
    studentski = {
      source      = "studentski-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Studentski district"
    }
    sredec = {
      source      = "sredec-sofia-org"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Sredec district"
    }
    serdika = {
      source      = "serdika-egov-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Serdika district"
    }
    slatina = {
      source      = "so-slatina-org"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Slatina district"
    }
    lozenets = {
      source      = "lozenets-sofia-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Lozenets district"
    }
    raioniskar = {
      source      = "raioniskar-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Raion Iskar website"
    }
    rayon-pancharevo = {
      source      = "rayon-pancharevo-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Rayon Pancharevo website"
    }
    rayon-ilinden = {
      source      = "rayon-ilinden-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Rayon Ilinden website"
    }
    triaditsa = {
      source      = "triaditsa-org"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Triaditsa district website"
    }
    krasna-polyana = {
      source      = "krasna-polyana-org"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Krasna Polyana district website"
    }
    vrabnitsa = {
      source      = "vrabnitsa-org"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Vrabnitsa district website"
    }
    nadezhda = {
      source      = "nadezhda-org"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Nadezhda district website"
    }
    inspectorat-so = {
      source      = "inspectorat-so-org"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Stolichen inspektorat news"
    }
    nimh-severe-weather = {
      source      = "nimh-severe-weather"
      memory      = "512Mi"
      timeout     = "1800s"
      description = "Crawl NIMH severe weather warnings"
    }
    sensor-community = {
      source      = "sensor-community"
      memory      = "512Mi"
      timeout     = "600s"
      description = "Evaluate sensor.community air quality data"
      emergent    = true
    }
    sofia-capital-of-sport = {
      source      = "sofia-capital-of-sport"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl Sofia Capital of Sport events"
    }
    sdvr-mvr = {
      source      = "sdvr-mvr-bg"
      memory      = "1Gi"
      timeout     = "1800s"
      description = "Crawl SDVR news"
    }
  }
}
