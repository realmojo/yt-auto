import Foundation
import Vision
import AppKit

func ocr(_ path: String) -> String {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { return "" }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["ko-KR", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { return "" }
    guard let obs = req.results as? [VNRecognizedTextObservation] else { return "" }
    // Vision 좌표는 하단 기준(y 클수록 위) → y 내림차순 = 위에서 아래 순서
    let lines = obs.compactMap { o -> (CGFloat, String)? in
        guard let t = o.topCandidates(1).first?.string else { return nil }
        return (o.boundingBox.origin.y, t)
    }.sorted { $0.0 > $1.0 }
    return lines.map { $0.1 }.joined(separator: " ")
}

for p in CommandLine.arguments.dropFirst() {
    let text = ocr(p).trimmingCharacters(in: .whitespacesAndNewlines)
    print("\(p)\t\(text)")
}
