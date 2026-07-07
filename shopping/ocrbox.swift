import Foundation
import Vision
import AppKit

// 이미지에서 텍스트 관측의 바운딩박스를 출력(자막영역 마스킹용).
// 중국어(간체/번체)+한국어+영어 인식. 좌표는 Vision 기준(정규화, 좌하단 원점).
// 출력(탭구분): x  y  w  h  confidence  text
func boxes(_ path: String) {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { return }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["zh-Hans", "zh-Hant", "ko-KR", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { return }
    guard let obs = req.results as? [VNRecognizedTextObservation] else { return }
    for o in obs {
        let b = o.boundingBox
        let cand = o.topCandidates(1).first
        let conf = cand?.confidence ?? 0
        let text = (cand?.string ?? "").replacingOccurrences(of: "\t", with: " ")
        print(String(format: "%.5f\t%.5f\t%.5f\t%.5f\t%.3f\t%@",
                     b.origin.x, b.origin.y, b.size.width, b.size.height, conf, text))
    }
}

for p in CommandLine.arguments.dropFirst() { boxes(p) }
