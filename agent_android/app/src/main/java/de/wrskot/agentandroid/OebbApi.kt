package de.wrskot.agentandroid

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class CheckResult(val available: Boolean)

object OebbApi {
    private const val GATE_URL = "https://fahrplan.oebb.at/gate"
    private const val AID = "5vHavmuWPWIfetEe"
    private const val API_VERSION = "1.88"
    private const val CLIENT_VERSION = 22001

    fun check(): CheckResult {
        val request = JSONObject()
            .put("id", "android-${System.currentTimeMillis()}")
            .put("ver", API_VERSION)
            .put("lang", "deu")
            .put("auth", JSONObject().put("type", "AID").put("aid", AID))
            .put(
                "client",
                JSONObject()
                    .put("id", "OEBB")
                    .put("type", "WEB")
                    .put("name", "webapp")
                    .put("l", "vs_webapp")
                    .put("v", CLIENT_VERSION),
            )
            .put("formatted", false)
            .put("ext", "OEBB.14")
            .put("svcReqL", JSONArray().put(tripSearchRequest()))

        val connection = (URL("$GATE_URL?rnd=${System.currentTimeMillis()}").openConnection()
            as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 30_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "OEBB-Monitor-Android/1.0")
        }

        try {
            connection.outputStream.use { it.write(request.toString().toByteArray(Charsets.UTF_8)) }
            val statusCode = connection.responseCode
            val responseStream = if (statusCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            val body = responseStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: throw IOException("ÖBB-Antwort ohne Inhalt (HTTP $statusCode).")
            if (statusCode !in 200..299) {
                throw IOException("ÖBB-Fahrplan antwortete mit HTTP $statusCode.")
            }
            return parseResponse(JSONObject(body))
        } finally {
            connection.disconnect()
        }
    }

    internal fun parseResponse(response: JSONObject): CheckResult {
        val topLevelError = response.optString("err", "OK")
        if (topLevelError != "OK") {
            throw IOException("ÖBB-Fahrplanfehler: ${response.optString("errTxt", topLevelError)}")
        }

        val serviceResponses = response.optJSONArray("svcResL")
            ?: throw IOException("ÖBB-Antwort enthält keine Fahrplandaten.")
        if (serviceResponses.length() == 0) {
            throw IOException("ÖBB-Antwort enthält keine Fahrplandaten.")
        }

        val service = serviceResponses.getJSONObject(0)
        val serviceError = service.optString("err", "OK")
        if (serviceError == "H890") {
            return CheckResult(available = false)
        }
        if (serviceError != "OK") {
            throw IOException("ÖBB-Fahrplanfehler: ${service.optString("errTxt", serviceError)}")
        }

        val result = service.optJSONObject("res")
            ?: throw IOException("ÖBB-Antwort enthält kein Suchergebnis.")
        val connections = result.optJSONArray("outConL") ?: JSONArray()
        return CheckResult(available = connections.length() > 0)
    }

    private fun tripSearchRequest(): JSONObject {
        val departure = JSONObject()
            .put(
                "lid",
                "A=1@O=Wien Hbf (U)@X=16377950@Y=48184986@U=81@L=1290401@",
            )
            .put("name", "Wien Hbf (U)")
            .put("eteId", "dep_0|S|Wien Hbf (U)|1290401|16377950|48184986")

        val arrival = JSONObject()
            .put("lid", "A=1@O=Trencin@X=18051850@Y=48896608@U=81@L=5600105@")
            .put("name", "Trencin")
            .put(
                "globalIdL",
                JSONArray()
                    .put(JSONObject().put("id", "5613866").put("type", "U"))
                    .put(JSONObject().put("id", "56TRE").put("type", "B")),
            )
            .put("eteId", "arr_0|S|Trencin|5600105|18051850|48896608")

        val journeyFilter = JSONObject()
            .put("type", "PROD")
            .put("mode", "INC")
            .put("value", 15359)

        val request = JSONObject()
            .put("depLocL", JSONArray().put(departure))
            .put("arrLocL", JSONArray().put(arrival))
            .put("minChgTime", "-1")
            .put("liveSearch", false)
            .put("maxChg", "0")
            .put("jnyFltrL", JSONArray().put(journeyFilter))
            .put("getPolyline", true)
            .put("outFrwd", true)
            .put("outTime", "000000")
            .put("outDate", "20270428")
            .put("getPasslist", true)
            .put("getTariff", true)

        return JSONObject()
            .put("meth", "TripSearch")
            .put("req", request)
            .put("id", "1|1|")
    }
}
